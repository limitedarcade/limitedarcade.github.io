// Make hidden attack assets participate in both compilation and a real draw.
// compileAsync alone neither uploads vertex buffers nor renders hidden nodes.
// Restore all scene state even if a shader or GPU upload fails.
export async function warmCombatAssets({ renderer, scene, camera, target, roots, shadowRoot = null }) {
  const previousTarget = renderer.getRenderTarget();
  const parents = [], states = new Map();
  try {
    renderer.setRenderTarget(target);
    // Hidden attack lights change the shader variant when summoned. Prepare
    // the ordinary arena lighting as well as the visible attack variant.
    await renderer.compileAsync(scene, camera);
    for (const root of roots.filter(Boolean)) {
      if (!root.parent) { scene.add(root); parents.push(root); }
      root.traverse(node => {
        if (states.has(node)) return;
        states.set(node, { visible: node.visible, frustumCulled: node.frustumCulled });
        if (node.isLight || node.isCamera) return;
        node.visible = true; node.frustumCulled = false;
      });
    }
    const textures = new Set();
    scene.traverse(node => {
      for (const material of [].concat(node.material || [])) {
        for (const value of Object.values(material)) {
          if (value?.isTexture && !value.isRenderTargetTexture && !value.isVideoTexture) textures.add(value);
        }
      }
    });
    for (const texture of textures) renderer.initTexture(texture);
    renderer.setRenderTarget(target);
    await renderer.compileAsync(scene, camera);
    if (shadowRoot) {
      // Shadow rendering omits fog; keep the finisher's prepared depth variant.
      const fog = scene.fog; scene.fog = null;
      try { await renderer.compileAsync(shadowRoot, camera, scene); }
      finally { scene.fog = fog; }
    }
    renderer.render(scene, camera);
  } finally {
    for (const [node, state] of states) Object.assign(node, state);
    for (const root of parents) scene.remove(root);
    renderer.setRenderTarget(previousTarget);
  }
}
