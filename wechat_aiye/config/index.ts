import { resolve } from 'node:path';
import { defineConfig, type UserConfigExport } from '@tarojs/cli';
import devConfig from './dev';
import prodConfig from './prod';

export default defineConfig<'vite'>(async (merge, { command, mode }) => {
  const baseConfig: UserConfigExport<'vite'> = {
    projectName: 'wechat_aiye',
    date: '2026-06-11',
    designWidth: 750,
    sourceRoot: 'src',
    outputRoot: process.env.TARO_OUTPUT_DIR || 'dist',
    plugins: [],
    alias: {
      '@': resolve(__dirname, '..', 'src'),
    },
    framework: 'react',
    compiler: {
      type: 'vite',
    },
    mini: {
      postcss: {
        pxtransform: {
          enable: true,
          config: {},
        },
        cssModules: {
          enable: true,
          config: {
            namingPattern: 'module',
            generateScopedName: '[name]__[local]___[hash:base64:5]',
          },
        },
      },
    },
    h5: {
      publicPath: '/',
      staticDirectory: 'static',
      postcss: {
        pxtransform: { enable: true, config: {} },
        cssModules: {
          enable: true,
          config: {
            namingPattern: 'module',
            generateScopedName: '[name]__[local]___[hash:base64:5]',
          },
        },
      },
    },
  };

  if (command === 'build' && mode === 'production') {
    return merge({}, baseConfig, prodConfig);
  }

  return merge({}, baseConfig, devConfig);
});
