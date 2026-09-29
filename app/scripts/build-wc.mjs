import esbuild from 'esbuild';

await esbuild.build({
  entryPoints: ['src/wc-login.js'],
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: ['es2022'],
  outfile: 'www/js/wc-login.js',
  minify: true,
  legalComments: 'none',
  inject: ['src/buffer-polyfill.js'],
  define: {
    'process.env.NODE_ENV': '"production"'
  }
});
