/// <reference types="@figma/plugin-typings" />

// Core export function (defined first)
async function exportFrames(frames: SceneNode[], context: string, pagesData?: Array<{ name: string; frameCount: number }>) {
  console.log(`📤 Exporting ${frames.length} frames...`);

  figma.ui.postMessage({
    type: 'progress',
    message: `Exporting ${frames.length} frames...`
  });

  const exportedFrames = [];

  for (let i = 0; i < frames.length; i++) {
    const frame = frames[i];

    console.log(`🖼️ Exporting frame ${i + 1}/${frames.length}: ${frame.name}`);

    figma.ui.postMessage({
      type: 'progress',
      message: `Exporting ${i + 1}/${frames.length}: ${frame.name}`
    });

    try {
      const isLargeFrame = (frame as FrameNode).height > 2000 || (frame as FrameNode).width > 2000;

      const imageBytes = await (frame as ExportMixin).exportAsync({
        format: 'PNG',
        constraint: { type: 'SCALE', value: isLargeFrame ? 1 : 2 }
      });

      const base64 = figma.base64Encode(imageBytes);

      let pageName = 'Unknown Page';
      let parent = frame.parent;
      while (parent && parent.type !== 'PAGE') {
        parent = parent.parent;
      }
      if (parent && parent.type === 'PAGE') {
        pageName = parent.name;
      }

      exportedFrames.push({
        id: frame.id,
        name: frame.name,
        pageName: pageName,
        width: (frame as FrameNode).width,
        height: (frame as FrameNode).height,
        imageData: base64,
        type: frame.type
      });
    } catch (error) {
      console.error(`❌ Failed to export ${frame.name}:`, error);
      figma.ui.postMessage({
        type: 'error',
        message: `Failed to export ${frame.name}: ${error}`
      });
    }
  }

  figma.ui.postMessage({
    type: 'export-complete',
    data: {
      fileName: figma.root.name,
      context: context,
      pages: pagesData,
      frames: exportedFrames
    }
  });
}

async function exportSelection() {
  const selection = figma.currentPage.selection;
  const frames = selection.filter(node =>
    node.type === 'FRAME' ||
    node.type === 'COMPONENT' ||
    node.type === 'INSTANCE'
  );

  if (frames.length === 0) {
    figma.ui.postMessage({
      type: 'error',
      message: 'No frames selected. Please select at least one frame.'
    });
    return;
  }

  await exportFrames(frames, 'Selected Frames');
}

async function exportCurrentPage() {
  const frames = figma.currentPage.findAll(node =>
    node.type === 'FRAME' ||
    node.type === 'COMPONENT'
  );

  if (frames.length === 0) {
    figma.ui.postMessage({
      type: 'error',
      message: 'No frames found on current page.'
    });
    return;
  }

  await exportFrames(frames as SceneNode[], figma.currentPage.name);
}

async function exportAllPages() {
  const allFrames: SceneNode[] = [];
  const pagesData: Array<{ name: string; frameCount: number }> = [];

  for (const page of figma.root.children) {
    const frames = page.findAll(node =>
      node.type === 'FRAME' ||
      node.type === 'COMPONENT'
    );

    if (frames.length > 0) {
      pagesData.push({ name: page.name, frameCount: frames.length });
      allFrames.push(...frames as SceneNode[]);
    }
  }

  if (allFrames.length === 0) {
    figma.ui.postMessage({
      type: 'error',
      message: 'No frames found in entire file.'
    });
    return;
  }

  figma.ui.postMessage({
    type: 'progress',
    message: `Found ${allFrames.length} frames across ${pagesData.length} pages`
  });

  await exportFrames(allFrames, 'All Pages', pagesData);
}

// Smart Export — sequential node extraction, one frame at a time
async function smartExport(frames: SceneNode[]) {
  // Flatten parent frames into their direct children
  const framesToExtract: SceneNode[] = [];
  for (const frame of frames) {
    if ('children' in frame && frame.children.length > 0) {
      const childFrames = frame.children.filter(c =>
        c.type === 'FRAME' || c.type === 'COMPONENT' || c.type === 'SECTION'
      ) as SceneNode[];
      if (childFrames.length > 0) {
        framesToExtract.push(...childFrames);
      } else {
        framesToExtract.push(frame);
      }
    } else {
      framesToExtract.push(frame);
    }
  }

  const totalFrames = framesToExtract.length;
  figma.ui.postMessage({
    type: 'progress',
    message: `Starting Smart Export of ${totalFrames} sections...`
  });

  // Extract frames one by one — send each to UI for upload as we go
  for (let i = 0; i < framesToExtract.length; i++) {
    const frame = framesToExtract[i];
    figma.ui.postMessage({
      type: 'progress',
      message: `Extracting ${i + 1}/${totalFrames}: ${frame.name}...`
    });

    const nodeData = await extractNode(frame);

    // Send each frame individually to UI for sequential upload
    figma.ui.postMessage({
      type: 'smart-frame-ready',
      data: {
        node: nodeData,
        fileName: figma.root.name,
        frameIndex: i,
        totalFrames,
        isLast: i === framesToExtract.length - 1,
      }
    });

    // Wait for UI to confirm upload before moving to next frame
    await new Promise<void>(resolve => {
      const handler = (msg: { type: string }) => {
        if (msg.type === 'frame-uploaded') {
          figma.ui.off('message', handler);
          resolve();
        }
      };
      figma.ui.on('message', handler);
    });
  }
}

// Extract node data (depth limited to avoid timeout)
async function extractNode(node: SceneNode, depth = 0): Promise<object> {
  const base: Record<string, unknown> = {
    id: node.id,
    name: node.name,
    type: node.type,
    x: 'x' in node ? node.x : 0,
    y: 'y' in node ? node.y : 0,
    width: 'width' in node ? node.width : 0,
    height: 'height' in node ? node.height : 0,
  };

  if ('fills' in node) base.fills = node.fills;
  if ('strokes' in node) base.strokes = node.strokes;
  if ('effects' in node) base.effects = node.effects;
  if ('opacity' in node) base.opacity = node.opacity;
  if ('cornerRadius' in node) base.cornerRadius = node.cornerRadius;

  if ('layoutMode' in node) {
    base.layoutMode = node.layoutMode;
    base.paddingTop = node.paddingTop;
    base.paddingBottom = node.paddingBottom;
    base.paddingLeft = node.paddingLeft;
    base.paddingRight = node.paddingRight;
    base.itemSpacing = node.itemSpacing;
    base.primaryAxisAlignItems = node.primaryAxisAlignItems;
    base.counterAxisAlignItems = node.counterAxisAlignItems;
  }

  if (node.type === 'TEXT') {
    base.characters = node.characters;
    base.fontSize = node.fontSize;
    base.fontName = node.fontName;
    base.fontWeight = 'fontWeight' in node ? node.fontWeight : undefined;
    base.textAlignHorizontal = node.textAlignHorizontal;
    base.lineHeight = node.lineHeight;
    base.letterSpacing = node.letterSpacing;
  }

  // Only extract images from nodes with actual image fills
  if ('fills' in node && Array.isArray(node.fills)) {
    const hasImageFill = node.fills.some((f: Paint) => f.type === 'IMAGE');
    if (hasImageFill && 'exportAsync' in node) {
      try {
        const bytes = await (node as ExportMixin).exportAsync({
          format: 'PNG',
          constraint: { type: 'SCALE', value: 1 }
        });
        base.imageData = figma.base64Encode(bytes);
      } catch { }
    }
  }

  if ('children' in node && depth < 3) {
    base.children = [];
    for (const child of node.children) {
      const childData = await extractNode(child as SceneNode, depth + 1);
      (base.children as object[]).push(childData);
    }
  }

  return base;
}

// Show plugin UI
figma.showUI(__html__, {
  width: 400,
  height: 600,
  themeColors: true
});

// Listen for messages from UI
figma.ui.onmessage = async (msg) => {
  console.log('📨 Received message from UI:', msg);

  if (msg.type === 'export-selection') {
    await exportSelection();
  } else if (msg.type === 'export-page') {
    await exportCurrentPage();
  } else if (msg.type === 'export-all') {
    await exportAllPages();
  } else if (msg.type === 'smart-export') {
    const selection = figma.currentPage.selection.filter(n =>
      n.type === 'FRAME' || n.type === 'COMPONENT'
    );
    if (selection.length === 0) {
      figma.ui.postMessage({ type: 'error', message: 'No frames selected for Smart Export.' });
      return;
    }
    await smartExport(selection as SceneNode[]);
  } else if (msg.type === 'cancel') {
    figma.closePlugin();
  } else if (msg.type === 'open-url') {
    figma.openExternal(msg.url as string);
  }
};