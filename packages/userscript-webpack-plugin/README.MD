
# Userscript Webpack Plugin
![MIT License](https://img.shields.io/badge/License-MIT-green.svg)

## Description

**userscript-webpack-plugin** is a Webpack plugin designed to simplify the process of adding a userscript header to your final build. It is particularly useful for developers creating userscripts, as it automates the inclusion of metadata required by userscript managers like [Tampermonkey](https://www.tampermonkey.net/) or [Greasemonkey](https://www.greasespot.net/).

This plugin reads configuration options from a specified JSON file and injects the appropriate userscript header into your output bundle, ensuring that your userscript is properly formatted and ready for distribution.

## Installation

To install the **userscript-webpack-plugin** in your package within this monorepo, add it as a dependency by doing:

```bash
npm install userscript-webpack-plugin -w your_package
```

## Usage

To use the **userscript-webpack-plugin** in your Webpack configuration, import the plugin and add it to the plugins array in your `webpack.config.ts` or `webpack.config.js` file:

```typescript
import UserScriptPlugin from 'userscript-webpack-plugin';

const config: Configuration = {
  // ...your config...
  plugins: [
    new UserScriptPlugin({
      configFile: 'userscript.config.json',
    }),
  ],
};

export default config;

```

## Plugin options

| Option | Type  | Description  |
|---|---|---|
| `configFile` | `string` | Path to the configuration file in JSON format. Properties from this file will be overridden by values specified in the configuration object (the options object provided to the plugin). |
| `extension` | `string \| RegExp \| RegExpObject \| Array<string \| RegExpObject \| RegExp>` | File extension(s) for UserScript files. Defaults to ".user.js". During the webpack bundle, this plugin will search for files matching the specified extension(s) and inject the userscript header if a match is found. |
| `format`  | `FormatFunction` | Function to format the entries in the UserScript header. |
| `keyToName`  | `HeaderKeyToNameFunction` | Function to map header keys to their corresponding names. Since names are JSON-key compatible and do not contain Unicode, this function can be used to rename a key. |
| `header`  | `Partial<HeaderNotStrict>` | Metadata block/header for the UserScript. Only specified fields will be included in the generated header. |
| `order`  | `Array<HeaderKey>` | Specifies the order of keys in the UserScript header. If not provided, the plugin will use a default pre-determined order. |
| `allowUnkownKeys`  | `boolean` | Allows unknown keys in the header configuration. If set to `false`, it will throw an error if an unknown key is encountered. Defaults to `false`. |
| `autoAlignment`  | `boolean` | Enables automatic alignment of fields in the header for better readability. Defaults to `true`. |
| `injectFromCurrentPackage`  | `Partial<PackageInjection> \| boolean` | Determines if current npm package details should be injected into the UserScript header. |
| `openTag`  | `string` | Defines the opening tag for the UserScript header. Defaults to `'==UserScript=='`. |
| `closeTag`  | `string` | Defines the closing tag for the UserScript header. Defaults to `==/UserScript==`. |
| `prefix`  | `string` | Prefix to be added to each line of the UserScript header. Because the UserScript header is basically a JavaScript comment, the prefix is default to `// `. |
| `suffix`  | `string` | Suffix to be added to each line of the UserScript header. Defaults to `''`. |
| `watch`  | `boolean` | Runs a `devServer` only in Webpack watch mode. Injects/overrides `@DownloadURL` and `@UpdateURL` tags in the header for automatic script updates. |

### `PackageInjection` Interface

| Option | Type  | Description  |
|---|---|---|
| `name` | `boolean` | Injects the current npm package name into the UserScript header. Defaults to `false`. |
| `version` | `boolean` | Injects the current npm package version into the UserScript header. Defaults to `false`. |
| `description` | `boolean` | Injects the current npm package description into the UserScript header. Defaults to `false`. |
| `license` | `boolean` | Injects the current npm package license into the UserScript header. Defaults to `false`. |
| `author` | `boolean` | Injects the current npm package author into the UserScript header. Defaults to `false`. |

### `HeaderNotStrict` Interface

| Option | Type  | Description  |
|---|---|---|
| `name` | `I18NValue` | The name of the script. |
| `namespace` | `SingleValue` | The namespace of the script. |
| `copyright` | `SingleValue` | Copyright statement shown at the header of the script's editor below the script name. |
| `license` | `SingleValue` | License information for the script. |
| `version` | `SingleValue` | Script version, used for update checks. |
| `description` | `I18NValue` | 	A short, significant description of the script. |
| `icon` | `SingleValue` | 	The script icon in low resolution. |
| `icon64` | `SingleValue` | The script icon in 64x64 pixels. |
| `grant` | `MultipleValueNullable` | Whitelists `GM_*`, `GM.*` functions, `unsafeWindow`, and certain `window` functions. Can be set to `null` to disable the sandbox. |
| `author` | `SingleValue` | The script's author. |
| `homepage` | `SingleValue` | The author's homepage, linked from the script's name on the options page. |
| `antifeature` | `MultipleI18NValue` | Discloses whether the script monetizes with ads, tracking, or mining. |
| `require` | `MultipleValue` | Points to a JavaScript file that is loaded and executed before the script starts running. |
| `resource` | `MultipleValue<TagResource>` | Preloads resources accessible via `GM_getResourceURL` and `GM_getResourceText`. |
| `include` | `MultipleValue` | Specifies pages on which the script should run. |
| `match` | `MultipleValue` | 	Specifies web pages where the script should run using a URL pattern. |
| `exclude` | `MultipleValue` | Excludes URLs even if they are included by `include` or `match`. |
| `runAt` | `SingleValue<EnumValue<TagRunAt>>` | Defines the moment the script is injected (e.g., `document-start`, `document-end`, etc.). |
| `sandbox` | `SingleValue<EnumValue<TagSandbox>>` | Specifies the environment for the script's injection (`MAIN_WORLD`, `ISOLATED_WORLD`, `USERSCRIPT_WORLD`). |
| `connect` | `MultipleValue` | Defines domains or subdomains allowed to be retrieved by `GM_xmlhttpRequest`. |
| `noframes` | `SingleValue` | 	Ensures the script runs only on main pages, not in iframes. |
| `updateURL` | `SingleValue` | URL for script updates. Requires a version tag for updates to work. |
| `downloadURL` | `SingleValue` | URL for downloading the script upon update detection. |
| `supportURL` | `SingleValue` | URL for reporting issues and getting support. |
| `webRequest` | `SingleValue` | Takes a JSON document that matches `GM_webRequest`'s `rule` parameter to apply rules before the userscript is loaded. |
| `unwrap` | `boolean` | Injects the userscript without any wrapper and sandbox into the page, useful for Scriptlets. |

## Additional Interfaces, Types and Enums

### `RegExpObject` Interface
An interface representing a regular expression object that is JSON compatible.

| **Option**   | **Type**       | **Description**                                                                  |
|--------------|----------------|----------------------------------------------------------------------------------|
| expression   | `string`       | The regular expression pattern as a string.                                      |
| flags        | `Array<string>`| An array of flags (`g`, `i`, `m`, etc.) that modify the behavior of the pattern. |


### `TagRunAt` Enum
An enum that specifies different points at which a tag or script can be executed during a document's lifecycle.

| **Name**          | **Value**          | **Description**                                                                 |
|-------------------|--------------------|---------------------------------------------------------------------------------|
| DocumentStart     | `'document-start'` | Executes the tag or script at the start of the document.                        |
| DocumentBody      | `'document-body'`  | Executes the tag or script when the document body is being processed.           |
| DocumentEnd       | `'document-end'`   | Executes the tag or script at the end of the document.                          |
| DocumentIdle      | `'document-idle'`  | Executes the tag or script when the document is idle.                           |
| ContextMenu       | `'context-menu'`   | Executes the tag or script when a context menu is invoked.                      |


### `TagSandbox` Enum
An enum that specifies the sandbox environment in which a tag or script can be executed.

| **Name**    | **Value**     | **Description**                                                                 |
|-------------|---------------|---------------------------------------------------------------------------------|
| Raw         | `'raw'`       | The tag or script is executed in a raw environment without any sandboxing.      |
| JavaScript  | `'JavaScript'`| The tag or script is executed in a JavaScript sandbox.                          |
| DOM         | `'DOM'`       | The tag or script is executed in a DOM (Document Object Model) sandbox.         |


### `TagResource` Interface
A type representing a resource associated with a tag.

| **Option**  | **Type**      | **Description**                                                                 |
|-------------|---------------|---------------------------------------------------------------------------------|
| type        | `string`      | The type of the resource (e.g., `string`).                                      |
| uri         | `string`      | The URI of the resource.                                                        |


### `SingleValue` Type
A type representing a single value.

| **Type**      | **Description**                                                                 |
|---------------|---------------------------------------------------------------------------------|
| `string`      | A single value of type `string`.                                                |


### `SingleValueNullable` Type
A type representing a single nullable value.

| **Type**                | **Description**                                                                 |
|-------------------------|---------------------------------------------------------------------------------|
| `SingleValue \| null`   | A single value of type `string` or `null`.                                      |


### `MultipleValue` Type
A type representing multiple values.

| **Type**           | **Description**                                                                 |
|--------------------|---------------------------------------------------------------------------------|
| `Array<string>`    | An array of values of type `string`.                                            |


### `MultipleValueNullable` Type
A type representing multiple nullable values.

| **Type**                | **Description**                                                                 |
|-------------------------|---------------------------------------------------------------------------------|
| `Array<string \| null>` | An array of values of type `string` or `null`.                                       |


### `I18NValue` Type
A type representing an internationalized value.

| **Type**                      | **Description**                   |
|-------------------------------|-----------------------------------|
| `I18NValueObject \| string`   | An internationalized value.       |

### `I18NValueObject` object
A type representing an internationalized value. It includes a `default` value as a fallback if a recognized language is not provided.

| **Option**  | **Type**      | **Description**                                                                   |
|-------------|---------------|-----------------------------------------------------------------------------------|
| default     | `string`      | The default value used as a fallback if the specified language is not recognized. |
| {LANGUAGE}  | `string`      | Will be used if the current language {LANGUAGE} is recognized. |

Example:
```json
{
  "default": "My userscript",
  "fr": "Mon userscript",
  "ja": "私のユーザースクリプト"
}
```

### `I18NValueNullable` Type
A type representing a nullable internationalized value.

| **Type**              | **Description**                   |
|-----------------------|-----------------------------------|
| `I18NValue \| null`   | A nullable `I18NValue`.           |


### `MultipleI18NValue` Type
A type representing multiple internationalized values.

| **Type**           | **Description**                      |
|--------------------|--------------------------------------|
| `Array<I18NValue>` | An array of `I18NValue` values.      |


## License

This project is licensed under the **MIT** License. See the LICENSE file for details.
