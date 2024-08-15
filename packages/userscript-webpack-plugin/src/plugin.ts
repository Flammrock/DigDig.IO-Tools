/*------------------------------------------------------------------*\
| Copyright (c) 2024 Flammrock                                       |
|                                                                    |
| This source code is licensed under the MIT license found in the    |
| LICENSE file in the root directory of this source tree.            |
\*------------------------------------------------------------------*/

// TODO: assets inject (css, image)
// TODO: Dev server (HMR: https://webpack.js.org/concepts/hot-module-replacement/)
// TODO: provide custom package.json file path

/* eslint-disable @typescript-eslint/no-explicit-any */

import fs from 'fs'
import path from 'path'
import JSON5 from 'json5'
import { Compilation, Compiler, WebpackPluginInstance } from 'webpack'
import { FormatFunction, PackageInjection, PluginOptions } from './types/configuration'
import { Header, HeaderKey, HeaderNotStrict } from './types/tags'
import { PermissiveObject, RegExpObject } from './types/helpers'
import { ConfigurationSchema, HeaderSchema } from './schemas'
import { ValidateConfiguration } from './validators/configuration'
import { ValidateHeader } from './validators/tags'

/**
 * Specifies the order of keys for the {@link Header}.
 * Keys are ordered based on their appearance in the UserScript header.
 *
 * **Note**: This array may not contain all properties of the {@link Header} interface.
 * It is solely used for defining the order of keys in the UserScript header.
 *
 * **Warning**: The tag &commat;name must be the first tag in Tampermonkey userscript header.
 *
 * The order can be modified by providing a custom array in the configuration object
 * of the {@link PluginOptions}.
 */
export const OrderHeader: Array<HeaderKey> = [
  'name', // note: must be the first tag in Tampermonkey
  'version',
  'description',
  'author',
  'copyright',
  'icon',
  'icon64',
  'grant',
  'homepage',
  'antifeature',
  'require',
  'resource',
  'include',
  'match',
  'exclude',
  'runAt',
  'sandbox',
  'connect',
  'noframes',
  'license',
  'namespace',
  'updateURL',
  'downloadURL',
  'supportURL',
  'webRequest',
  'unwrap'
]

const I18NKeys: Array<HeaderKey> = ['name', 'description', 'antifeature']
const I18NKeysMap = new Map(I18NKeys.map((key, index) => [key, index]))

/**
 * Maps header keys to their corresponding order index.
 * Used to determine the order of keys in the UserScript header.
 */
const OrderHeaderMap = new Map(OrderHeader.map((key, index) => [key, index]))

/**
 * Converts a header key to its corresponding name in the UserScript header.
 *
 * @param key The key of the UserScript header.
 * @returns The name of the key in the UserScript header.
 */
const HeaderKeyToName = (key: HeaderKey): string => {
  if (key === 'runAt') return 'run-at'
  return key
}

/**
 * Generates a UserScript header string based on the provided header object.
 *
 * @param header The {@link Header} containing metadata information.
 * @returns A string representing the generated UserScript header.
 */
const GenerateHeader = (header: Partial<HeaderNotStrict>, options: Partial<PluginOptions> = {}): string => {
  const result: Array<string> = []
  const prefix = options.prefix ?? '// '
  const suffix = options.suffix ?? ''
  const openTag = options.openTag ?? '==UserScript=='
  const closeTag = options.closeTag ?? '==/UserScript=='
  const injectFromCurrentPackage = options.injectFromCurrentPackage

  // Compute max size for auto-alignment
  let maxSize = Math.max(...OrderHeader.map((key) => key.length))
  // Compute max key size with dynamic i18n
  for (const i18nKeys of I18NKeys) {
    maxSize = Math.max(
      maxSize,
      ...Object.keys(typeof (header as any)[i18nKeys] === 'object' ? (header as any)[i18nKeys] : {}).map(
        (key) => i18nKeys.length + (key !== 'default' ? key.length : 0) + 1
      )
    )
  }
  maxSize += 2

  // ==UserScript==
  result.push(`${prefix}${openTag}${suffix}`)

  // Take into account the request key order (TODO: can't be use for i18n)
  const localOrder = new Map(options.order?.map((key, index) => [key, index]))

  // Retrieve the known properties
  const knownProperties = HeaderSchema.properties ?? {}

  // Helper function to render an entry in the header
  const renderHeaderField: FormatFunction =
    options.format ??
    ((name, value, code) => {
      const i18n = typeof code !== 'undefined' ? ':' + code : ''
      return `${prefix}@${name}${i18n}${(options.autoAlignment ?? true) ? ' '.repeat(maxSize - name.length - i18n.length) : ' '}${value}${suffix}`
    })

  // Helper function to handle tag
  const addHeaderField = (name: string, value: unknown) => {
    if (typeof value === 'string') {
      result.push(renderHeaderField(name, value, undefined, options))
    } else if (value !== null && typeof value === 'object') {
      if (I18NKeysMap.has(name as keyof Header)) {
        for (const code in value)
          result.push(renderHeaderField(name, (value as any)[code], code === 'default' ? undefined : code, options))
      }
    } else if (Array.isArray(value)) {
      for (const subValue in value) addHeaderField(name, subValue)
    }
  }

  // Try to inject the current npm package information
  if (injectFromCurrentPackage) {
    // Default injection config if not success to find the requested one
    const defaultPropsToInject: PackageInjection = {
      version: true,
      author: true,
      description: true,
      license: true,
      name: true
    }

    // Try to retrieve keys of an UserScriptHeaderPackageInjection interface
    const fromSchema =
      (ConfigurationSchema.properties as any) ??
      ({
        injectFromCurrentPackage: { properties: defaultPropsToInject }
      } as any)

    // Choose from the retrieved one or the default config
    const extractFromSchema =
      (fromSchema.injectFromCurrentPackage.properties as PermissiveObject<PackageInjection>) ?? defaultPropsToInject

    // Handle different case of injectFromCurrentPackage (boolean and object)
    const propertiesToInject = (
      typeof injectFromCurrentPackage === 'boolean'
        ? injectFromCurrentPackage
          ? extractFromSchema
          : {}
        : injectFromCurrentPackage
    ) as Partial<PermissiveObject<PackageInjection>>

    // Extract current package properties from package.json
    const jsonPackage = JSON5.parse(fs.readFileSync(path.resolve('package.json'), 'utf-8')) as Partial<
      PermissiveObject<PackageInjection>
    >

    // Inject requested injection properties from package to the userscript header
    for (const property in propertiesToInject) {
      if (property in jsonPackage) header[property] = jsonPackage[property] ?? header[property] // try to override
    }
  }

  // Use the computed local order to sort the header keys
  // (fallback to the default order if needed)
  const ordered = (Object.keys(header) as Array<HeaderKey>).sort((a, b) =>
    localOrder.has(a) && localOrder.get(b)
      ? (localOrder.get(a) ?? 0) - (localOrder.get(b) ?? 0)
      : (OrderHeaderMap.get(a) ?? OrderHeaderMap.size) - (OrderHeaderMap.get(b) ?? OrderHeaderMap.size)
  )

  // Iterate on the sorted/ordered header keys
  for (const key of ordered) {
    // Extract the value
    const value = (header as any)[key]

    // Convert the key to a name
    // (try to use the requested custom, fallback to default if needed)
    const name = (options.keyToName ?? HeaderKeyToName)(key) ?? HeaderKeyToName(key)

    // Check if we can inject unknow key in the header
    if (!options.allowUnknownKeys) {
      if (key in knownProperties) addHeaderField(name, value)
    } else {
      addHeaderField(name, value)
    }
  }

  // ==/Userscript==
  result.push(`${prefix}${closeTag}${suffix}`)
  result.push('')

  return result.join('\n')
}

/**
 * Represents a Webpack 5 plugin for injecting UserScript headers into the bundle.
 */
export class UserScriptPlugin implements WebpackPluginInstance {
  private options: Partial<PluginOptions>
  private header: Partial<Header>
  private headerString: string

  public static getName() {
    return 'UserScriptPlugin'
  }

  /**
   * Creates an instance of UserScriptPlugin.
   *
   * @param options Options for configuring the plugin.
   */
  constructor(options?: Partial<PluginOptions>) {
    this.options = options || {}
    this.header = this.options.header || {}

    if (this.options.configFile) {
      const loadedOptions = JSON5.parse(fs.readFileSync(path.resolve(this.options.configFile), 'utf-8'))
      const loadedHeader = loadedOptions.header ?? {}
      delete loadedOptions.header
      const result = ValidateConfiguration({ ...loadedOptions })
      if (!result.isValid) {
        throw new Error('Invalid configuration file. Error:' + result.message)
      }

      this.options = { ...this.options, ...loadedOptions }
      this.header = { ...loadedHeader, ...(this.options.header || {}) }
      const resultHeader = ValidateHeader({ ...this.header }, this.options.allowUnknownKeys)
      if (!resultHeader.isValid) {
        console.log({ ...loadedHeader, ...(this.options.header || {}) })
        throw new Error(
          'Invalid header. You might use config.allowUnknownKeys = true for allowing unknow keys. Error: ' +
            resultHeader.message
        )
      }
    }

    this.headerString = GenerateHeader(this.header, this.options)
  }

  /**
   * Checks if the given file matches the specified extensions.
   *
   * @param file The filename to be checked for a match.
   * @returns A boolean indicating whether the file matches the specified extensions.
   */
  private match(file: string): boolean {
    const { extension = '.user.js' } = this.options

    const isExtensionMatch = (extension: string | RegExp | RegExpObject) => {
      if (extension instanceof RegExp) {
        return extension.test(file)
      } else if (typeof extension === 'string') {
        return file.endsWith(extension)
      } else {
        return new RegExp(extension.expression, extension.flags.join('')).test(file)
      }
    }

    if (Array.isArray(extension)) {
      for (const ext of extension) {
        if (isExtensionMatch(ext)) return true
      }
    } else {
      return isExtensionMatch(extension)
    }

    return false
  }

  /**
   * Applies the plugin to the Webpack compiler.
   *
   * @param compiler The Webpack compiler instance.
   */
  public apply(compiler: Compiler) {
    const { ConcatSource } = compiler.webpack.sources
    const cache = new WeakMap()

    compiler.hooks.compilation.tap(UserScriptPlugin.getName(), (compilation) => {
      const webpackConfig = compiler.options

      if (compiler.watchMode) {
        if (typeof webpackConfig.devServer !== 'undefined') {
          throw new Error(`'${UserScriptPlugin.getName()}' plugin must own the devServer configuration object.`)
        }
      }

      compilation.hooks.processAssets.tap(
        {
          name: UserScriptPlugin.getName(),
          stage: Compilation.PROCESS_ASSETS_STAGE_REPORT // Run the plugin at the end
        },
        () => {
          for (const chunk of compilation.chunks) {
            // Only add the usercript header for entry chunk
            if (!chunk.canBeInitial()) continue

            for (const file of chunk.files) {
              // Check if the current chunk is an userscript
              if (!this.match(file)) continue

              const data = {
                chunk,
                filename: file
              }

              const comment = compilation.getPath(this.headerString, data)

              compilation.updateAsset(file, (old) => {
                const cached = cache.get(old)
                if (!cached || cached.comment !== comment) {
                  const source = new ConcatSource(this.headerString, '\n', old)
                  cache.set(old, { source, comment })
                  return source
                }
                return cached.source
              })
            }
          }
        }
      )
    })
  }
}

export default UserScriptPlugin
