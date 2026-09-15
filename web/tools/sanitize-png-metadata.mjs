#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const TEXT_CHUNKS = new Set(["tEXt", "zTXt", "iTXt"]);

function parsePng(buffer, filename) {
  if (buffer.length < PNG_SIGNATURE.length || !buffer.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new Error(`${filename}: not a PNG file`);
  }

  const chunks = [];
  let offset = 8;
  while (offset < buffer.length) {
    if (offset + 12 > buffer.length) throw new Error(`${filename}: truncated PNG chunk`);
    const length = buffer.readUInt32BE(offset);
    const end = offset + 12 + length;
    if (end > buffer.length) throw new Error(`${filename}: invalid PNG chunk length`);
    const type = buffer.toString("ascii", offset + 4, offset + 8);
    chunks.push({ type, bytes: buffer.subarray(offset, end) });
    offset = end;
    if (type === "IEND") break;
  }

  if (chunks.at(-1)?.type !== "IEND" || offset !== buffer.length) {
    throw new Error(`${filename}: malformed PNG ending`);
  }
  return chunks;
}

function pixelDataHash(chunks) {
  const hash = createHash("sha256");
  for (const chunk of chunks) if (chunk.type === "IDAT") hash.update(chunk.bytes);
  return hash.digest("hex");
}

if (process.argv.length < 3) {
  console.error("Usage: node tools/sanitize-png-metadata.mjs <png> [png ...]");
  process.exit(2);
}

for (const argument of process.argv.slice(2)) {
  const filename = resolve(argument);
  const original = readFileSync(filename);
  const chunks = parsePng(original, filename);
  const cleanedChunks = chunks.filter((chunk) => !TEXT_CHUNKS.has(chunk.type));
  const removed = chunks.filter((chunk) => TEXT_CHUNKS.has(chunk.type));

  if (removed.length === 0) {
    console.log(`${argument}: no text metadata`);
    continue;
  }

  if (pixelDataHash(chunks) !== pixelDataHash(cleanedChunks)) {
    throw new Error(`${filename}: pixel data changed during metadata removal`);
  }

  writeFileSync(filename, Buffer.concat([PNG_SIGNATURE, ...cleanedChunks.map((chunk) => chunk.bytes)]));
  console.log(`${argument}: removed ${removed.map((chunk) => chunk.type).join(", ")}; pixel data unchanged`);
}
