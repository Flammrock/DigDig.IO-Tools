/*------------------------------------------------------------------*\
| Copyright (c) 2024 Flammrock                                       |
|                                                                    |
| This source code is licensed under the MIT license found in the    |
| LICENSE file in the root directory of this source tree.            |
\*------------------------------------------------------------------*/

import { RegExpObject } from './helpers'
import { HeaderKey, HeaderNotStrict } from './tags'

/**
 * Represents the configuration options for the UserScriptPlugin.
 *
 * When initializing the UserScriptPlugin, these options can be provided
 * to customize the behavior of the plugin.
 *
 * If a `configFile` is specified, it should point to a JSON file containing
 * additional settings or metadata for the UserScriptPlugin. Properties defined
 * in this file will be overridden by any corresponding values specified directly
 * in the configuration object, allowing for flexible customization.
 *
 * The `header` property allows specifying a metadata block or header
 * for the generated UserScript files. This header contains information such as
 * the script's name, version, description, author, and other relevant details.
 * Only specified fields will be included in the generated UserScript header.
 *
 * If the `extension` property is not provided, the generated UserScript files
 * will default to using the ".user.js" extension. However, an alternate extension
 * can be specified if needed.
 */
export interface PluginOptions extends Omit<Configuration, 'extension'> {
  /**
   * The path to the configuration file in JSON format must be a {@link Configuration}.
   * If defined, properties loaded from this file will be overridden by the
   * values specified in the configuration object.
   * Example: "/path/to/config.json"
   */
  configFile: string

  /**
   * The file extension(s) for user scripts.
   * This property specifies the extension(s) to be used for the generated UserScript files.
   * It can be a string representing a single extension, a regular expression matching
   * multiple extensions, or an array containing a combination of strings and regular expressions.
   * If not provided, defaults to ".user.js".
   * Example: ".user.js", /\.user\.js$/, [".user.js", /\.user\.user\.js$/]
   */
  extension: string | RegExp | RegExpObject | Array<string | RegExpObject | RegExp>

  format: FormatFunction
  keyToName: HeaderKeyToNameFunction
}

export type FormatFunction = (
  name: string,
  value: unknown,
  i18nCode: string | undefined,
  options: Partial<PluginOptions>
) => string

export type HeaderKeyToNameFunction = (key: HeaderKey) => string | void | null | undefined

export interface PackageInjection {
  /**
   * Indicates whether to inject the current npm package name into the UserScript header.
   * If set to true, the name of the current package will be injected into the generated header.
   * Default to false.
   */
  name: boolean

  /**
   * Indicates whether to inject the current npm package version into the UserScript header.
   * If set to true, the version of the current package will be injected into the generated header.
   * Default to false.
   */
  version: boolean

  /**
   * Indicates whether to inject the current npm package description into the UserScript header.
   * If set to true, the description of the current package will be injected into the generated header.
   * Default to false.
   */
  description: boolean

  /**
   * Indicates whether to inject the current npm package license into the UserScript header.
   * If set to true, the license of the current package will be injected into the generated header.
   * Default to false.
   */
  license: boolean

  /**
   * Indicates whether to inject the current npm package author into the UserScript header.
   * If set to true, the author of the current package will be injected into the generated header.
   * Default to false.
   */
  author: boolean
}

export interface Configuration {
  /**
   * Metadata block/header for the UserScript.
   * Only specified fields will be included in the generated header.
   */
  header: Partial<HeaderNotStrict>

  /**
   * The file extension(s) for user scripts.
   * This property specifies the extension(s) to be used for the generated UserScript files.
   * It can be a string representing a single extension, a regular expression matching
   * multiple extensions, or an array containing a combination of strings and regular expressions.
   * If not provided, defaults to ".user.js".
   *
   * @example
   * ```
   * ".user.js"
   * { expression: "/\\.user\\.js$/" }
   * [".user.js", { expression: "/\\.user\\.user\\.js$/", flags: ["i"] }]
   * ```
   */
  extension: string | RegExpObject | Array<string | RegExpObject>

  /**
   * Specifies the key order for the UserScript header.
   * Customization is possible by providing a custom array.
   * If a key is not present in the custom array,
   * the default order will be used for that key.
   *
   * @see {@link OrderHeader}
   * @see {@link UserScriptHeader}
   */
  order: Array<HeaderKey>

  /**
   * Indicates whether unknown keys are allowed in the configuration.
   * If set to true, unknown keys within the 'header' property will not result in validation errors.
   * Default to false.
   *
   * Unknown keys specifically pertain to properties inside the 'header' object and will be considered
   * and added during the rendering of the UserScript header.
   */
  allowUnknownKeys: boolean

  /**
   * Indicates whether automatic alignment of fields in the header is enabled.
   * If set to true, fields in the header will be automatically aligned for better readability.
   * Default to true.
   *
   * @example
   * **Warning**: the following contains invisible character (U+2063) before each `@` character
   * to prevent JSDoc to break. This is weird but a known issue: https://github.com/microsoft/TypeScript/issues/47679
   *
   * If set to `false`, it will produce for example:
   * ```typescript
   * // ==UserScript==
   * // ⁣@name New Userscript
   * // ⁣@namespace http://tampermonkey.net/
   * // ⁣@description try to take over the world!
   * // ⁣@author You
   * // ⁣@icon data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==
   * // ⁣@grant none
   * // ==/UserScript==
   * ```
   *
   * **But** If set to `true` (or unset), it will produce for example:
   * ```typescript
   * // ==UserScript==
   * // ⁣@name         New Userscript
   * // ⁣@namespace    http://tampermonkey.net/
   * // ⁣@description  try to take over the world!
   * // ⁣@author       You
   * // ⁣@icon         data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==
   * // ⁣@grant        none
   * // ==/UserScript==
   * ```
   */
  autoAlignment: boolean

  injectFromCurrentPackage: Partial<PackageInjection> | boolean

  openTag: string
  closeTag: string
  prefix: string
  suffix: string

  /**
   * If `true`, it will run a devServer only in webpack watch mode and
   * it will inject/override &commat;DownloadURL and &commat;UpdateURL tags
   * in the header that point to the devServer urls in order to refresh
   * automatically the userscript after each file modifications.
   */
  watch: boolean
}

// the following is only use to generate the schema using `npm run schemas:generate`
type ConfigurationNotStrict = Partial<Configuration>
