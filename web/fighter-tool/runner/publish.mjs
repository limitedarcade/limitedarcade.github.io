import { copyFileSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { GAME_ROOT, TOOL_ROOT } from './config.mjs';
import { CLIPS } from '../tools/fighterRig.mjs';
import { encodeFighter, threejsDir } from './encode.mjs';

export function outputDir(id) {
  return join(TOOL_ROOT, 'output', id);
}

const THREEJS_FILES = ['meshCodec.js', 'surfaceData.js', 'rigData.js', 'createFighterModel.js', 'parity.json'];

function assetRecord(cfg, parity) {
  return {
    schemaVersion: 2,
    id: cfg.id,
    displayName: cfg.displayName || cfg.id,
    runtime: 'threejs-factory',
    factory: 'threejs/createFighterModel.js',
    skeleton: 'canonical-fighter-v1',
    clips: parity?.clips || CLIPS.map((clip) => clip.name),
    verts: parity?.verts ?? null,
    tris: parity?.tris ?? null,
    source: 'Force-measured encode of a Route C rigged GLB',
    runtimeUse: 'threejs-factory',
    measurement: `${cfg.id}-rigged.glb`,
  };
}

function copyThreejs(srcDir, destDir) {
  mkdirSync(destDir, { recursive: true });
  for (const f of THREEJS_FILES) {
    const from = join(srcDir, f);
    if (existsSync(from)) copyFileSync(from, join(destDir, f));
  }
  return destDir;
}

function packReadme(asset) {
  return `# ${asset.displayName}

Three.js factory — no \`.glb\` is loaded at runtime.

\`\`\`js
import { prewarm, createFighter } from './threejs/createFighterModel.js';

await prewarm();
const { group, play, update, explode } = createFighter();
scene.add(group);
play('idle');
// in the frame loop: update(dt)
// explode(0..1) separates the six named parts
\`\`\`

Clips: ${asset.clips.join(', ')}.
Skeleton: canonical-fighter-v1 (25 bones).
${asset.verts ? `Packed ${asset.verts} verts / ${asset.tris} tris.` : ''}

\`${asset.measurement}\` is the measurement source the factory was encoded from. Do not ship it in the game. The factory is the deliverable.
`;
}

export function exportCharacter(cfg, riggedGlb, joints, opts = {}) {
  const id = cfg.id;
  const destDir = outputDir(id);
  mkdirSync(destDir, { recursive: true });
  const destGlb = join(destDir, `${id}-rigged.glb`);
  copyFileSync(riggedGlb, destGlb);

  const parity = opts.parity || encodeFighter(cfg, riggedGlb, { onEvent: opts.onEvent });
  const pack = copyThreejs(threejsDir(id), join(destDir, 'threejs'));
  const asset = assetRecord(cfg, parity);
  writeFileSync(join(destDir, 'asset.json'), JSON.stringify(asset, null, 2) + '\n');
  writeFileSync(join(destDir, 'README.md'), packReadme(asset));
  return { destDir, destGlb, pack, asset, parity };
}

function fighterJs(cfg, authoredHeight) {
  const id = cfg.id;
  const label = cfg.displayName || (id[0].toUpperCase() + id.slice(1));
  return `export const ${id}Fighter = Object.freeze({
  id: '${id}',
  label: ${JSON.stringify(label)},
  runtime: 'threejs',
  create: () => import('./${id}/createFighterModel.js'),
  authoredHeight: ${authoredHeight},
  facingRotationY: Math.PI / 2,
  clips: Object.freeze({
    bind: 'tpose',
    idle: 'idle',
    guard: 'guard',
    light: 'jab',
  }),
  effects: Object.freeze({
    practiceFinisher: 'paperBurst',
  }),
});
`;
}

function installGameFactory(id) {
  const srcDir = threejsDir(id);
  const shared = join(GAME_ROOT, 'src/fighters/_shared');
  mkdirSync(shared, { recursive: true });
  copyFileSync(join(TOOL_ROOT, 'runtime/meshCodec.js'), join(shared, 'meshCodec.js'));
  const dest = join(GAME_ROOT, 'src/fighters', id);
  mkdirSync(dest, { recursive: true });
  copyFileSync(join(srcDir, 'surfaceData.js'), join(dest, 'surfaceData.js'));
  copyFileSync(join(srcDir, 'rigData.js'), join(dest, 'rigData.js'));
  if (existsSync(join(srcDir, 'parity.json'))) {
    copyFileSync(join(srcDir, 'parity.json'), join(dest, 'parity.json'));
  }
  let factory = readFileSync(join(srcDir, 'createFighterModel.js'), 'utf8');
  factory = factory
    .replace(/from ['"]three['"]/, "from '../../vendor/three.module.js'")
    .replace(/from ['"]\.\/meshCodec\.js['"]/, "from '../_shared/meshCodec.js'");
  writeFileSync(join(dest, 'createFighterModel.js'), factory);
  return dest;
}

function patchCatalog(id) {
  const path = join(GAME_ROOT, 'src/fighters/catalog.js');
  let src = readFileSync(path, 'utf8');
  const importLine = `import { ${id}Fighter } from './${id}.js';`;
  if (!src.includes(`from './${id}.js'`)) {
    const lastImport = [...src.matchAll(/^import .+$/gm)].pop();
    if (lastImport) {
      const at = lastImport.index + lastImport[0].length;
      src = src.slice(0, at) + '\n' + importLine + src.slice(at);
    } else src = importLine + '\n' + src;
  }
  const entry = `[${id}Fighter.id, ${id}Fighter]`;
  if (!src.includes(entry)) {
    src = src.replace(
      /const catalog = new Map\(\[([\s\S]*?)\]\);/,
      (_, inner) => {
        const trimmed = inner.trim().replace(/,+$/, '');
        return `const catalog = new Map([\n  ${trimmed},\n  ${entry},\n]);`;
      },
    );
  }
  writeFileSync(path, src);
}

function patchMainQuery() {
  const path = join(GAME_ROOT, 'src/main.js');
  if (!existsSync(path)) return false;
  let src = readFileSync(path, 'utf8');
  if (src.includes('searchParams.get(\'fighter\')')) return false;
  if (!src.includes("getFighter('trump')")) return false;
  src = src.replace(
    "const fighterDefinition = getFighter('trump');",
    "const fighterDefinition = getFighter(new URLSearchParams(location.search).get('fighter') || 'trump');",
  );
  writeFileSync(path, src);
  return true;
}

export function publishFighter(cfg, riggedGlb, joints, opts = {}) {
  const id = cfg.id;
  const exported = exportCharacter(cfg, riggedGlb, joints, opts);
  const factoryDir = installGameFactory(id);
  const authoredHeight = 1.92;
  writeFileSync(join(GAME_ROOT, 'src/fighters', `${id}.js`), fighterJs(cfg, authoredHeight));
  patchCatalog(id);
  const hooked = patchMainQuery();
  return {
    outputDir: exported.destDir,
    factoryDir,
    asset: exported.asset,
    parity: exported.parity,
    catalog: join(GAME_ROOT, 'src/fighters/catalog.js'),
    module: join(GAME_ROOT, 'src/fighters', `${id}.js`),
    practiceUrl: `http://127.0.0.1:5176/?fighter=${id}`,
    hooked,
    authoredHeight,
    figureHeight: joints?.height ?? null,
  };
}
