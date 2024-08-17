# Custom Font

This package allows you to generate a custom font with icons, similar to FontAwesome.
All icons are located in the `./icons` directory.

## Icon Directories

- `./icons/duotone`: Icons with two colors (SVG format only).
- `./icons/regular`: Classic monochrome icons (SVG format only).

## Prerequisites

Ensure you use an npm package like `css-loader` to import CSS from external npm modules.

## Building the Fonts

To build the fonts, run the following command:

```bash
yarn run build
```

This command generates the font files (.ttf, .eot, .woff2, etc.) and the CSS files, similar to FontAwesome.

## Usage

### Regular Font

1. Import the CSS file for the regular font:

```typescript
import 'custom-font/dist/custom-font-regular.css';
```

2. Use the icons with the following HTML class names:

```html
<i class="cf-regular cf-mouse"></i>
```

### Duotone Font

1. Import the CSS file for the duotone font:

```typescript
import 'custom-font/dist/custom-font-duotone.css';
```

2. Use the icons with the following HTML class names:

```html
<i class="cf-duotone cf-mouse-left"></i>
```

3. To change the secondary color of duotone icons, use:

```html
<i style="--2: #2fc200;" class="cf-duotone cf-mouse-left"></i>
```

4. To set the primary color (note: primary color inheritance from the parent may make this redundant), use:

```html
<i style="--1: #009eff;" class="cf-duotone cf-mouse-left"></i>
```

5. Alternatively, set the color directly:

```html
<i style="color: #009eff;" class="cf-duotone cf-mouse-left"></i>
```

## List of Icons

- See `./dist/custom-font-regular.html` to view all the available regular icons.
- See `./dist/custom-font-duotone.html` to view all the available duotone icons.

## License

This project is licensed under the **MIT** License. See the LICENSE file for details.
