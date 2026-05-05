import daStyle from 'eslint-config-dicodingacademy';
import pluginReact from 'eslint-plugin-react';

export default [
  {
    ignores: ['dist/**', 'dev-dist/**', 'node_modules/**', 'public/**'],
  },
  daStyle,
  {
    files: ['**/*.{js,jsx}'],
    plugins: {
      react: pluginReact,
    },
    languageOptions: {
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
        ecmaFeatures: {
          jsx: true,
        },
        babelOptions: {
          presets: ['@babel/preset-react'],
        },
      },
    },
    settings: {
      react: {
        version: 'detect',
      },
    },
    ignores: ['dist', 'node_modules'],
    rules: {
      ...pluginReact.configs.recommended.rules,
      'react/react-in-jsx-scope': 'off',
      'react/prop-types': 'off',
      'camelcase': 'off',
    },
  },
];
