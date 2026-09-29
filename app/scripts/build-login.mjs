import esbuild from 'esbuild';

await esbuild.build({
  entryPoints: ['src/login-client.js'],
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: ['es2022'],
  outfile: 'www/js/login.js',
  minify: true,
  legalComments: 'none',
  inject: ['src/buffer-polyfill.js'],
  define: {
    'process.env.NODE_ENV': '"production"'
  }
});
