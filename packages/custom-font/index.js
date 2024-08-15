/*------------------------------------------------------------------*\
| Copyright (c) 2024 Flammrock                                       |
|                                                                    |
| This source code is licensed under the MIT license found in the    |
| LICENSE file in the root directory of this source tree.            |
\*------------------------------------------------------------------*/

/**
 * @typedef DuoToneSVG
 * @type {object}
 * @property {string} path - The relative path to the SVG files.
 * @property {string} tone1 - The SVG string for tone 1.
 * @property {string} tone2 - The SVG string for tone 2.
 */

/**
 * @typedef RegularSVG
 * @type {object}
 * @property {string} path - The relative path to the SVG file.
 * @property {string} content - The SVG string.
 */

/** @typedef {import("@twbs/fantasticon").RunnerOptions} RunnerOptions */

const {
  generateFonts,
  FontAssetType,
  OtherAssetType,
} = require("@twbs/fantasticon");
const { parse, stringify } = require("svgson");
const fs = require("fs");
const path = require("path");
const Handlebars = require("handlebars");
const color = require("cli-color");

const pluralize = (word, amount) => (amount === 1 ? word : `${word}s`);

const logger = {
  indent: 0,
  push() {
    this.indent++;
  },
  pop() {
    this.indent--;
  },
  log(...args) {
    const indent = this.indent * 4 - 1;
    if (indent > 0) console.log(" ".repeat(indent), ...args);
    else console.log(...args);
  },
};

// Register custom helpers
Handlebars.registerHelper("endsWith", function (str, suffix) {
  return str.endsWith(suffix);
});
Handlebars.registerHelper("slice", function (str, start, end) {
  return str.slice(start, end);
});
Handlebars.registerHelper("stripSuffix", function (str) {
  return str.replace(/-t[12]$/, "");
});
Handlebars.registerHelper("lookup", function (obj, field) {
  return obj && obj[field];
});
Handlebars.registerHelper("set", function (key, value, options) {
  if (typeof options.data.root.uniqueKeys === "undefined") {
    options.data.root.uniqueKeys = {};
  }
  options.data.root.uniqueKeys[key] = value;
});

const input = {
  duotone: path.resolve(__dirname, "icons", "duotone"),
  regular: path.resolve(__dirname, "icons", "regular"),
};
const output = path.resolve(__dirname, "dist");
const templates = path.resolve(__dirname, "templates");

/** @type {RunnerOptions} */
const config = {
  name: "custom-font",
  outputDir: output,
  prefix: "cf",
  selector: "cf",
  fontTypes: [
    FontAssetType.EOT,
    FontAssetType.WOFF2,
    FontAssetType.WOFF,
    FontAssetType.TTF,
    FontAssetType.SVG,
  ],
  assetTypes: [
    OtherAssetType.CSS,
    OtherAssetType.HTML, //// Used only to visualize/debug the generated font
  ],
  tag: "i",
};

/**
 * Get the list recursively of all svgs.
 *
 * @param {string} dir
 * @param {*} fileList
 * @param {*} relativeDir
 * @returns {Array<RegularSVG>}
 */
function findSvgFiles(dir, fileList = [], relativeDir = "") {
  const files = fs.readdirSync(dir);

  files.forEach((file) => {
    const fullPath = path.join(dir, file);
    const relativePath = path.join(relativeDir, file);
    const stat = fs.statSync(fullPath);

    if (stat.isDirectory()) {
      findSvgFiles(fullPath, fileList, relativePath);
    } else if (path.extname(file).toLowerCase() === ".svg") {
      fileList.push({
        path: relativePath,
        content: fs.readFileSync(fullPath, "utf-8"),
      });
    }
  });

  return fileList;
}

/**
 * Transform the svg to a duotone-compatible svg.
 *
 * Note: It will separate filled from un-filled.
 * Only support very basic svg.
 *
 * @param {RegularSVG} svg
 * @returns {Promise<DuoToneSVG>}
 */
async function makeSvgDuotone(svg) {
  const ast = await parse(svg.content);
  const children = ast.children;
  const color1 = [];
  const color2 = [];
  for (const child of children) {
    if (
      typeof child.attributes !== "undefined" &&
      typeof child.attributes.fill !== "undefined"
    ) {
      color2.push(child);
    } else {
      color1.push(child);
    }
  }
  if (color1.length === 0 || color2.length === 0) {
    throw new Error(`SVG '${svg.path}' it not a duotone.`);
  }
  return {
    path: svg.path,
    tone1: stringify({ ...ast, ...{ children: color1 } }),
    tone2: stringify({ ...ast, ...{ children: color2 } }),
  };
}

/**
 * Writes duotone SVG files to the specified path, creating directories if they do not exist.
 * @param {string} root - The root directory to start from.
 * @param {DuoToneSVG} duotoneSvg - The duotone SVG.
 */
function writeSvgDuotone(root, duotoneSvg) {
  const dirPath = path.join(root, path.dirname(duotoneSvg.path));
  const fileName = path.basename(duotoneSvg.path, ".svg");

  // Ensure the directory exists
  fs.mkdirSync(dirPath, { recursive: true });

  // Write tone1 SVG file
  fs.writeFileSync(
    path.join(dirPath, `${fileName}-t1.svg`),
    duotoneSvg.tone1,
    "utf8",
  );

  // Write tone2 SVG file
  fs.writeFileSync(
    path.join(dirPath, `${fileName}-t2.svg`),
    duotoneSvg.tone2,
    "utf8",
  );
}

function results({ assetsIn, writeResults, options: { inputDir } }) {
  const iconsCount = Object.values(assetsIn).length;

  logger.log(
    color.white(
      `✔ ${iconsCount} ${pluralize("SVG", iconsCount)} found in ${path.basename(inputDir)}`,
    ),
  );

  for (const { writePath } of writeResults) {
    logger.log(
      color.blue(`✔ Generated`, color.blueBright(path.basename(writePath))),
    );
  }

  logger.log(color.green.bold("Done"));
}

async function generateDuotone() {
  logger.log(color.yellow("🔄 Generate [Duotone] font.."));
  logger.push();

  const svgs = findSvgFiles(input.duotone);
  const temp = path.resolve(__dirname, "temp");
  const tempduotone = path.resolve(temp, "duotone");

  // Cleanup before run the process
  fs.rmSync(temp, { recursive: true, force: true });
  fs.mkdirSync(tempduotone, { recursive: true });

  // Convert regular svg to duotone svg
  for (const svg of svgs) {
    writeSvgDuotone(tempduotone, await makeSvgDuotone(svg));
  }

  // Generate the duotone font
  results(
    await generateFonts(
      {
        ...config,
        ...{
          name:
            (typeof config.name === "string" ? `${config.name}-` : "") +
            "duotone",
          prefix: config.prefix,
          selector:
            (typeof config.selector === "string" ? `${config.selector}-` : "") +
            "duotone",
          inputDir: tempduotone,
          templates: {
            css: path.join(templates, "css-duotone.hbs"),
            html: path.join(templates, "html-duotone.hbs"),
          },
        },
      },
      true,
    ),
  );

  // Cleanup
  fs.rmSync(temp, { recursive: true, force: true });

  logger.pop();
  logger.log(color.yellow("🙂 [Duotone] font generated."));
}

async function generateRegular() {
  logger.log(color.yellow("🔄 Generate [Regular] font.."));
  logger.push();
  // Generate the regular font
  results(
    await generateFonts(
      {
        ...config,
        ...{
          name:
            (typeof config.name === "string" ? `${config.name}-` : "") +
            "regular",
          prefix: config.prefix,
          selector:
            (typeof config.selector === "string" ? `${config.selector}-` : "") +
            "regular",
          inputDir: input.regular,
          templates: {
            css: path.join(templates, "css-regular.hbs"),
            html: path.join(templates, "html-regular.hbs"),
          },
        },
      },
      true,
    ),
  );
  logger.pop();
  logger.log(color.yellow("🙂 [Regular] font generated."));
}

async function main() {
  logger.log(color.magenta("() Cleaning.."));
  fs.rmSync(output, { recursive: true, force: true });
  fs.mkdirSync(output, { recursive: true });
  logger.log(color.magenta("() Generate fonts.."));
  await generateRegular();
  await generateDuotone();
  logger.log(color.magenta("() Done!"));
}

main();

//console.log(svgs)

/**
generateFonts({
  name,
  fontTypes: [FontAssetType.EOT, FontAssetType.WOFF2, FontAssetType.WOFF],
  assetTypes: [
    OtherAssetType.CSS,
    OtherAssetType.HTML,
    OtherAssetType.JSON,
    OtherAssetType.TS
  ],
  formatOptions: { json: { indent: 2 } },
  tag: 'i',
  prefix: name
}).then(results => console.log(results))
*/
