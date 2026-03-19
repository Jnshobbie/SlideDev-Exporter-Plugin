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
      // Export as PNG (2x resolution for quality)
      const isLargeFrame = (frame as FrameNode).height > 2000 || (frame as FrameNode).width > 2000;

      const imageBytes = await (frame as ExportMixin).exportAsync({
        format: 'PNG',
        constraint: { type: 'SCALE', value: isLargeFrame ? 1 : 2 }
      });
      console.log(` Exported ${frame.name}: ${imageBytes.length} bytes`);

      // Convert to base64
      const base64 = figma.base64Encode(imageBytes);
      console.log(` Converted to base64: ${base64.length} chars`);

      // Get parent page name
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

  console.log(`✅ Export complete: ${exportedFrames.length} frames`);

  // Send to UI for upload
  figma.ui.postMessage({
    type: 'export-complete',
    data: {
      fileName: figma.root.name,
      context: context,
      pages: pagesData,
      frames: exportedFrames
    }
  });
  console.log('📨 Sent export-complete message to UI');
}

// Export selected frames
async function exportSelection() {
  console.log('🔍 Getting selection...');
  const selection = figma.currentPage.selection;
  console.log(`📊 Selection count: ${selection.length}`);

  const frames = selection.filter(node =>
    node.type === 'FRAME' ||
    node.type === 'COMPONENT' ||
    node.type === 'INSTANCE'
  );
  console.log(`🖼️ Frames found: ${frames.length}`);

  if (frames.length === 0) {
    console.warn('⚠️ No frames selected');
    figma.ui.postMessage({
      type: 'error',
      message: 'No frames selected. Please select at least one frame.'
    });
    return;
  }

  await exportFrames(frames, 'Selected Frames');
}

// Export current page
async function exportCurrentPage() {
  console.log('📄 Exporting current page...');
  const frames = figma.currentPage.findAll(node =>
    node.type === 'FRAME' ||
    node.type === 'COMPONENT'
  );
  console.log(`🖼️ Found ${frames.length} frames on current page`);

  if (frames.length === 0) {
    console.warn('⚠️ No frames found on current page');
    figma.ui.postMessage({
      type: 'error',
      message: 'No frames found on current page.'
    });
    return;
  }

  await exportFrames(frames as SceneNode[], figma.currentPage.name);
}

// Export all pages
async function exportAllPages() {
  console.log('🌐 Exporting all pages...');
  const allFrames: SceneNode[] = [];
  const pagesData: Array<{ name: string; frameCount: number }> = [];

  for (const page of figma.root.children) {
    const frames = page.findAll(node =>
      node.type === 'FRAME' ||
      node.type === 'COMPONENT'
    );

    if (frames.length > 0) {
      console.log(`📄 Page "${page.name}": ${frames.length} frames`);
      pagesData.push({
        name: page.name,
        frameCount: frames.length
      });
      allFrames.push(...frames as SceneNode[]);
    }
  }

  if (allFrames.length === 0) {
    console.warn('⚠️ No frames found in file');
    figma.ui.postMessage({
      type: 'error',
      message: 'No frames found in entire file.'
    });
    return;
  }

  console.log(`✅ Found ${allFrames.length} total frames across ${pagesData.length} pages`);

  figma.ui.postMessage({
    type: 'progress',
    message: `Found ${allFrames.length} frames across ${pagesData.length} pages`
  });

  await exportFrames(allFrames, 'All Pages', pagesData);
}

async function smartExport(frames: SceneNode[], providedFileKey?: string) {
  figma.ui.postMessage({ type: 'progress', message: 'Preparing Smart Export...' });

// Try provided key first, then figma.fileKey
let fileKey = providedFileKey || figma.fileKey || rawFileKey;

if (!fileKey) {
  // Extract from figma URL pattern: figma.com/design/{fileKey}/...
  const url = (figma as unknown as { currentPage: { parent: { id: string } } }).currentPage?.parent?.id;
  console.log('🔑 Trying parent ID:', url);
}

console.log('🔑 File key:', fileKey);

if (!fileKey) {
  // Send message to UI to get the URL from the browser
  figma.ui.postMessage({ type: 'need-file-key' });
  return;
}

  // Get direct children if parent frame selected
  const nodeIds: string[] = [];
  for (const frame of frames) {
    if ('children' in frame && frame.children.length > 0) {
      const childFrames = frame.children.filter(c =>
        c.type === 'FRAME' || c.type === 'COMPONENT' || c.type === 'SECTION'
      );
      if (childFrames.length > 0) {
        childFrames.forEach(c => nodeIds.push(c.id));
      } else {
        nodeIds.push(frame.id);
      }
    } else {
      nodeIds.push(frame.id);
    }
  }

  figma.ui.postMessage({ 
    type: 'smart-export-ready', 
    data: { 
      fileKey, 
      nodeIds, 
      fileName: figma.root.name 
    } 
  });
}

// Get file key from figma or from the file's node ID
const rawFileKey = figma.fileKey ?? (() => {
  try {
    // On free plan, extract from root node ID which contains the file key
    const rootId = figma.root.id;
    console.log('🔑 Root ID:', rootId);
    return rootId.split(':')[0] || null;
  } catch {
    return null;
  }
})();

console.log('🔑 Resolved file key:', rawFileKey);

// Show plugin UI
console.log('🚀 Plugin starting...');
figma.showUI(__html__, {
  width: 400,
  height: 600,
  themeColors: true
});
console.log('✅ UI shown');

// Listen for messages from UI
figma.ui.onmessage = async (msg) => {
  console.log('📨 Received message from UI:', msg);

  if (msg.type === 'export-selection') {
    console.log('▶️ Starting export selection');
    await exportSelection();
  } else if (msg.type === 'export-page') {
    console.log('▶️ Starting export page');
    await exportCurrentPage();
  } else if (msg.type === 'export-all') {
    console.log('▶️ Starting export all');
    await exportAllPages();
  } else if (msg.type === 'smart-export') {
    const selection = figma.currentPage.selection.filter(n => n.type === 'FRAME' || n.type === 'COMPONENT');
    if (selection.length === 0) {
      figma.ui.postMessage({ type: 'error', message: 'No frames selected for Smart Export.' });
      return;
    }
    await smartExport(selection as SceneNode[]);
  } else if (msg.type === 'file-key-response') {
    const sel = figma.currentPage.selection.filter(n => n.type === 'FRAME' || n.type === 'COMPONENT');
    await smartExport(sel as SceneNode[], msg.fileKey as string);
  } else if (msg.type === 'cancel') {
    console.log('🔒 Closing plugin');
    figma.closePlugin();
  } else if (msg.type === 'open-url') {
    figma.openExternal(msg.url as string);
  } else {
    console.warn('⚠️ Unknown message type:', msg.type);
  }
};
console.log('✅ Message listener attached');