// news-image-20261121 entry (Node 22, standard library only).
//
// The entry is a single image: entry.png sits beside this file in the
// repository, and this program writes it to the grader's output directory.
// It does no drawing and no fetching — the picture is built ahead of time
// and shipped in the repo, so the run is deterministic: two runs of this
// program write byte-identical files.
//
// Run it outside the grader with:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts

import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// The image ships beside this script, so resolve it from the script's own
// path instead of trusting the working directory.
const here: string = dirname(fileURLToPath(import.meta.url));
const sourcePath: string = join(here, "entry.png");

if (!existsSync(sourcePath)) {
  throw new Error(`entry.png is missing next to main.ts (${sourcePath})`);
}

// The grader sets MAKEFUN_OUTPUT_DIR; /output is the fallback it documents.
// An empty value counts as unset, so a stray empty variable cannot point
// the output at the working directory by accident.
const outDirSetting: string | undefined = process.env.MAKEFUN_OUTPUT_DIR;
const outDir: string =
  outDirSetting !== undefined && outDirSetting !== "" ? outDirSetting : "/output";
const targetPath: string = join(outDir, "entry.png");

// Read the image once and check the guardrails the competition states
// before writing anything: at most 1 MiB, at most 1024 by 1024 pixels,
// and a whole PNG (the 8-byte signature, then complete chunks).
const bytes: Buffer = readFileSync(sourcePath);
const MAX_BYTES = 1024 * 1024;
if (bytes.length > MAX_BYTES) {
  throw new Error(`entry.png is ${bytes.length} bytes, over the ${MAX_BYTES} byte cap`);
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
if (!bytes.subarray(0, 8).equals(PNG_SIGNATURE)) {
  throw new Error("entry.png does not start with a PNG signature");
}

// The IHDR chunk follows the signature: 4-byte length, "IHDR", then width
// and height as 4-byte big-endian integers, then the bit depth and the
// colour type. Both fields have a small set of legal values; anything
// else means the header is corrupt even if the lengths look right.
const ihdrLength: number = bytes.readUInt32BE(8);
const ihdrType: string = bytes.subarray(12, 16).toString("latin1");
if (ihdrLength !== 13 || ihdrType !== "IHDR") {
  throw new Error("entry.png has no IHDR chunk where a PNG must carry one");
}
const width: number = bytes.readUInt32BE(16);
const height: number = bytes.readUInt32BE(20);
if (width > 1024 || height > 1024) {
  throw new Error(`entry.png is ${width}x${height}, over the 1024x1024 cap`);
}
const bitDepth: number = bytes[24];
const colourType: number = bytes[25];
if (![1, 2, 4, 8, 16].includes(bitDepth)) {
  throw new Error(`entry.png has an impossible IHDR bit depth: ${bitDepth}`);
}
if (![0, 2, 3, 4, 6].includes(colourType)) {
  throw new Error(`entry.png has an impossible IHDR colour type: ${colourType}`);
}

// PNG guards every chunk with a CRC-32 (the reflected IEEE polynomial,
// as in zip) over the chunk type and its data. The table is built once;
// checking each chunk's stored CRC against the computed one catches a
// file whose bytes were damaged in a way the length walk alone would
// step over, because a flipped byte inside a chunk keeps every length
// and offset exactly where it was.
const CRC_TABLE: Int32Array = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

// Walk the chunk list to the IEND chunk so a truncated file fails here
// instead of passing a partial image to the judge. Every chunk's CRC is
// verified on the way. IEND must also be the last chunk: bytes trailing
// after it would mean the file is not one whole image but an image with
// something appended.
let offset = 8;
let sawIend = false;
while (offset + 8 <= bytes.length) {
  const chunkLength: number = bytes.readUInt32BE(offset);
  const chunkType: string = bytes.subarray(offset + 4, offset + 8).toString("latin1");
  const chunkEnd: number = offset + 8 + chunkLength + 4;
  if (chunkEnd > bytes.length) {
    throw new Error(`entry.png ends inside the ${chunkType} chunk`);
  }
  const storedCrc: number = bytes.readUInt32BE(offset + 8 + chunkLength);
  const computedCrc: number = crc32(bytes.subarray(offset + 4, offset + 8 + chunkLength));
  if (storedCrc !== computedCrc) {
    throw new Error(`entry.png has a bad CRC in the ${chunkType} chunk`);
  }
  if (chunkType === "IEND") {
    sawIend = true;
    // IEND carries no data, only its 4-byte CRC: the file must end here.
    if (chunkEnd !== bytes.length) {
      throw new Error(
        `entry.png has ${bytes.length - chunkEnd} trailing bytes after IEND`,
      );
    }
    break;
  }
  offset = chunkEnd;
}
if (!sawIend) {
  throw new Error("entry.png has no IEND chunk: the file looks truncated");
}

mkdirSync(outDir, { recursive: true });
copyFileSync(sourcePath, targetPath);

// A silent short copy must never pass: the written file has to be the
// same bytes, checked by length and by SHA-256, before the run reports
// success. Length alone would miss a copy that kept the size but changed
// a byte; the hash catches that.
const written: number = statSync(targetPath).size;
if (written !== bytes.length) {
  throw new Error(`wrote ${written} bytes to ${targetPath}, expected ${bytes.length}`);
}
const writtenHash: string = createHash("sha256")
  .update(readFileSync(targetPath))
  .digest("hex");
const sourceHash: string = createHash("sha256").update(bytes).digest("hex");
if (writtenHash !== sourceHash) {
  throw new Error(`wrote bytes to ${targetPath} whose SHA-256 differs from entry.png`);
}

console.log(
  `wrote ${targetPath} (${written} bytes, ${width}x${height}, sha256 ${sourceHash})`,
);
