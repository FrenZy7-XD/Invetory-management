const fs = require('fs');
const content = fs.readFileSync('./frontend/index.html', 'utf8');
const scriptStart = content.indexOf('<script type="text/babel">');
const scriptEnd = content.lastIndexOf('</script>');
const script = content.substring(scriptStart + '<script type="text/babel">'.length, scriptEnd);

console.log('Testing JSX syntax via Babel...');
const babel = require('./backend/node_modules/@babel/core');
try {
  babel.transformSync(script, {
    presets: [
      ['./backend/node_modules/@babel/preset-react', { runtime: 'classic' }]
    ]
  });
  console.log('✅ Babel JSX compilation SUCCESSFUL! No syntax or parsing errors.');
} catch (err) {
  console.error('❌ Babel JSX compilation error:', err.message);
  if (err.loc) {
    console.error('At line:', err.loc.line, 'column:', err.loc.column);
    const lines = script.split('\n');
    console.error('Line context:', lines[err.loc.line - 1]);
  }
}
