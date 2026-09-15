import { createReadStream, existsSync, mkdirSync, readdirSync, statSync, writeFileSync, readFileSync } from 'node:fs';
import { dirname, extname, join, resolve, basename } from 'node:path';
import { checkEnvironment, validatePair } from '../runner/validate.mjs';
import { loadConfig, saveConfig, listConfigs, configPath, TOOL_ROOT, WEB_ROOT, buildDir, loadDefaults } from '../runner/config.mjs';
import { buildFighter } from '../runner/build-fighter.mjs';
import { evaluatePoseFile } from '../runner/gates.mjs';
import { sweepAim } from '../runner/sweep.mjs';
import { publishFighter, exportCharacter } from '../runner/publish.mjs';
import { compareShots } from '../runner/captureGate.mjs';
import { liveTune } from '../runner/liveTune.mjs';
import { encodeFighter } from '../runner/encode.mjs';

function send(res, code, body, type = 'application/json') {
  res.statusCode = code;
  res.setHeader('Content-Type', type);
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolveP, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const buf = Buffer.concat(chunks);
      const ct = req.headers['content-type'] || '';
      if (ct.includes('application/json') || buf[0] === 0x7b) {
        try { resolveP(JSON.parse(buf.toString('utf8') || '{}')); }
        catch (err) { reject(err); }
      } else resolveP({ raw: buf });
    });
    req.on('error', reject);
  });
}

function listGlbs(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.toLowerCase().endsWith('.glb'))
    .map((f) => {
      const p = join(dir, f);
      const st = statSync(p);
      return { name: f, path: p, bytes: st.size };
    });
}

export function fighterApi() {
  const shotDir = join(TOOL_ROOT, 'review', 'shots');
  mkdirSync(shotDir, { recursive: true });
  mkdirSync(join(TOOL_ROOT, 'inbox'), { recursive: true });
  mkdirSync(join(TOOL_ROOT, 'build'), { recursive: true });

  return {
    name: 'fighter-tool-api',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url && req.url.split('?')[0].endsWith('.glb')) {
          res.setHeader('Cache-Control', 'no-store');
        }
        next();
      });

      server.middlewares.use('/__shot', (req, res) => {
        if (req.method !== 'POST') { res.statusCode = 405; return res.end(); }
        const name = new URL(req.url, 'http://x').searchParams.get('name') || 'shot';
        const safe = name.replace(/[^a-z0-9_.-]/gi, '_');
        const chunks = [];
        req.on('data', (c) => chunks.push(c));
        req.on('end', () => {
          const out = join(shotDir, safe + '.png');
          writeFileSync(out, Buffer.from(Buffer.concat(chunks).toString(), 'base64'));
          res.end(out);
        });
      });

      server.middlewares.use('/sources', (req, res, next) => {
        const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '');
        const p = resolve(WEB_ROOT, rel);
        if (!p.startsWith(WEB_ROOT) || !existsSync(p) || !statSync(p).isFile()) return next();
        res.setHeader('Content-Type', 'model/gltf-binary');
        createReadStream(p).pipe(res);
      });

      server.middlewares.use('/__api', async (req, res) => {
        try {
          const url = new URL(req.url, 'http://x');
          const route = url.pathname.replace(/\/+$/, '') || '/';

          if (req.method === 'GET' && route === '/env') {
            return send(res, 200, await checkEnvironment());
          }
          if (req.method === 'GET' && route === '/defaults') {
            return send(res, 200, loadDefaults());
          }
          if (req.method === 'GET' && route === '/configs') {
            return send(res, 200, { ids: listConfigs() });
          }
          if (req.method === 'GET' && route.startsWith('/config/')) {
            const id = route.slice('/config/'.length);
            const p = configPath(id);
            if (!existsSync(p)) return send(res, 404, { error: 'no such config' });
            return send(res, 200, loadConfig(p));
          }
          if (req.method === 'GET' && route === '/sources') {
            return send(res, 200, {
              web: listGlbs(WEB_ROOT),
              inbox: listGlbs(join(TOOL_ROOT, 'inbox')),
            });
          }
          if (req.method === 'GET' && route.startsWith('/build/')) {
            const rest = route.slice('/build/'.length);
            const p = resolve(join(TOOL_ROOT, 'build'), rest);
            if (!p.startsWith(resolve(join(TOOL_ROOT, 'build'))) || !existsSync(p)) {
              return send(res, 404, { error: 'not found' });
            }
            if (extname(p) === '.json') return send(res, 200, JSON.parse(readFileSync(p, 'utf8')));
            res.setHeader('Content-Type', 'model/gltf-binary');
            return createReadStream(p).pipe(res);
          }

          if (req.method === 'POST' && route === '/validate') {
            const body = await readBody(req);
            const result = await validatePair(body.a, body.b);
            return send(res, 200, result);
          }
          if (req.method === 'PUT' && route.startsWith('/config/')) {
            const id = route.slice('/config/'.length);
            const body = await readBody(req);
            body.id = body.id || id;
            const p = configPath(id);
            saveConfig(p, body);
            return send(res, 200, { path: p });
          }
          if (req.method === 'POST' && route === '/upload') {
            const id = (url.searchParams.get('id') || 'drop').replace(/[^a-z0-9_-]/gi, '_');
            const name = (url.searchParams.get('name') || 'file.glb').replace(/[^a-z0-9_.-]/gi, '_');
            const dir = join(TOOL_ROOT, 'inbox', id);
            mkdirSync(dir, { recursive: true });
            const dest = join(dir, name);
            const chunks = [];
            req.on('data', (c) => chunks.push(c));
            req.on('end', () => {
              const buf = Buffer.concat(chunks);
              writeFileSync(dest, buf);
              send(res, 200, { path: dest, bytes: buf.length });
            });
            return;
          }
          if (req.method === 'POST' && route === '/live-tune') {
            const body = await readBody(req);
            const result = await liveTune(body);
            return send(res, 200, result);
          }
          if (req.method === 'POST' && route === '/pose') {
            const body = await readBody(req);
            const result = evaluatePoseFile(body.joints, body.gates || loadDefaults().gates);
            return send(res, 200, result);
          }
          if (req.method === 'POST' && route === '/sweep') {
            const body = await readBody(req);
            const result = sweepAim(body.joints, body.side, body);
            return send(res, 200, result);
          }
          if (req.method === 'POST' && route === '/compare') {
            const body = await readBody(req);
            return send(res, 200, compareShots(body.a, body.b, body.gates || {}));
          }
          if (req.method === 'POST' && route === '/encode') {
            const body = await readBody(req);
            const cfg = body.config || loadConfig(configPath(body.id));
            if (body.rerig !== false && cfg.rig) {
              await liveTune({ id: cfg.id, rig: cfg.rig, rerig: true });
            }
            const rigged = join(buildDir(cfg.id), `${cfg.id}_rigged.glb`);
            if (!existsSync(rigged)) return send(res, 400, { error: 'Build the fighter before packing it' });
            const parity = encodeFighter(cfg, rigged);
            return send(res, 200, parity);
          }
          if (req.method === 'POST' && route === '/export') {
            const body = await readBody(req);
            const cfg = body.config || loadConfig(configPath(body.id));
            const dir = buildDir(cfg.id);
            const rigged = join(dir, `${cfg.id}_rigged.glb`);
            const joints = JSON.parse(readFileSync(join(dir, `${cfg.id}_joints.json`), 'utf8'));
            const result = exportCharacter(cfg, rigged, joints);
            return send(res, 200, result);
          }
          if (req.method === 'POST' && route === '/publish') {
            const body = await readBody(req);
            const cfg = body.config || loadConfig(configPath(body.id));
            const dir = buildDir(cfg.id);
            const rigged = join(dir, `${cfg.id}_rigged.glb`);
            const joints = JSON.parse(readFileSync(join(dir, `${cfg.id}_joints.json`), 'utf8'));
            const result = publishFighter(cfg, rigged, joints);
            return send(res, 200, result);
          }
          if (req.method === 'POST' && route === '/run') {
            const body = await readBody(req);
            res.statusCode = 200;
            res.setHeader('Content-Type', 'text/event-stream');
            res.setHeader('Cache-Control', 'no-cache');
            res.setHeader('Connection', 'keep-alive');
            const sendEv = (ev) => res.write(`data: ${JSON.stringify(ev)}\n\n`);
            try {
              let cfg = body.config;
              if (body.configPath) cfg = loadConfig(body.configPath);
              if (body.id && !cfg) cfg = loadConfig(configPath(body.id));
              const man = await buildFighter(cfg, {
                onEvent: sendEv,
                from: body.from,
                skip: body.skip,
                publish: body.publish,
              });
              sendEv({ stage: 'done', status: 'pass', manifest: man });
            } catch (err) {
              sendEv({ stage: err.stage || 'run', status: 'fail', message: err.message });
            }
            res.end();
            return;
          }

          send(res, 404, { error: `no ${req.method} ${route}` });
        } catch (err) {
          send(res, 500, { error: err.message });
        }
      });
    },
  };
}
