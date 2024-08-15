/*------------------------------------------------------------------*\
| Copyright (c) 2024 Flammrock                                       |
|                                                                    |
| This source code is licensed under the MIT license found in the    |
| LICENSE file in the root directory of this source tree.            |
\*------------------------------------------------------------------*/

import fs from 'fs'
import path from 'path'
import JSON5 from 'json5'
import * as TJS from 'typescript-json-schema'

function toKebabCase(str: string): string {
  return str
    .replace(/UserScript/gi, 'Userscript')
    .replace(/^[A-Z]/g, (match) => match.toLowerCase())
    .replace(/[A-Z]/g, (match) => '-' + match.toLowerCase())
}

function generateSchemaFromInterface(interfaceName: string, interfaceFilePath: string, outputFolderPath: string): void {
  const settings: TJS.PartialArgs = { required: true }
  const tsConfigFilePath = path.resolve('tsconfig.json')
  if (!fs.existsSync(tsConfigFilePath)) throw new Error('Unable to find tsconfig.json.')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const options = (JSON5.parse(fs.readFileSync(tsConfigFilePath, 'utf-8')) as any)['compilerOptions'] ?? {}
  const program = TJS.getProgramFromFiles([interfaceFilePath], options)
  const generator = TJS.buildGenerator(program, settings)
  if (generator == null) throw new Error('Unable to build generator.')
  const symbolList = generator.getSymbols(interfaceName)
  if (symbolList.length == 0) throw new Error(`Unable to find the type '${interfaceName}'`)
  const schema = generator.getSchemaForSymbol(symbolList[0].name)
  const schemaFilePath = path.join(path.resolve(outputFolderPath), `${toKebabCase(interfaceName)}.schema.json`)
  fs.writeFileSync(schemaFilePath, JSON.stringify(schema, null, 2))
  console.log(`Schema generated for '${interfaceName}' and saved to ${schemaFilePath}`)
}

generateSchemaFromInterface('HeaderStrict', './src/types/tags.ts', './src/schemas')
generateSchemaFromInterface('HeaderNotStrict', './src/types/tags.ts', './src/schemas')
generateSchemaFromInterface('ConfigurationNotStrict', './src/types/configuration.ts', './src/schemas')
