import svelte from 'rollup-plugin-svelte';
import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import { terser } from 'rollup-plugin-terser';
import sveltePreprocess from 'svelte-preprocess';
import typescript from '@rollup/plugin-typescript';
import path from 'path';
import fs from 'fs';

const production = !process.env.ROLLUP_WATCH;

export default fs
  .readdirSync(path.join(process.cwd(), "webviews", "pages"))
  .map((input) => {
    const name = input.split(".")[0];
    return {
      input: `webviews/pages/${input}`,
      output: {
        sourcemap: true,
        format: "iife",
        name: "app",
        file: `out/compiled/${name}.js`,
      },
      plugins: [
        svelte({
          preprocess: sveltePreprocess(),
          dev: !production,
          css: (css) => {
            css.write(`${name}.css`);
          },
        }),
        resolve({
          browser: true,
          dedupe: ["svelte"],
          extensions: ['.svelte', '.ts']
        }),
        commonjs(),
        typescript({
          tsconfig: "webviews/tsconfig.json",
          sourceMap: !production,
          inlineSources: !production,
        }),
        production && terser()
      ],
      watch: {
        clearScreen: false,
      },
    };
  });