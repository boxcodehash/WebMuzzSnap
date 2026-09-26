import esbuild from 'esbuild';

await esbuild.build({
  entryPoints: ['src/main.js'],
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: ['es2022'],
  outfile: 'www/js/app.js',
  minify: true,
  legalComments: 'none',
  define: {
    'process.env.NODE_ENV': '"production"'
  }
});
