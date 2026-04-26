import readline from 'readline';

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

console.log('\x1b[34m[Claude Simulator]\x1b[39m Starting agentic task...');

let step = 1;
const interval = setInterval(() => {
  console.log(`\x1b[36m[Claude Simulator]\x1b[39m Analyzing files... (step ${step}/3)`);
  step++;
  
  if (step > 3) {
    clearInterval(interval);
    
    // Simulate Claude asking for permission with ANSI colors
    console.log('\n\x1b[32m?\x1b[39m \x1b[1mDo you want me to run this bash command? (Y/n)\x1b[22m');
    process.stdout.write('\x1b[33m>\x1b[39m ');
    
    rl.question('', (answer) => {
      console.log(`\n\x1b[34m[Claude Simulator]\x1b[39m Received input: "${answer}"`);
      console.log('\x1b[34m[Claude Simulator]\x1b[39m Continuing task based on approval...');
      
      setTimeout(() => {
        console.log('\x1b[32m✔ Task complete!\x1b[39m');
        rl.close();
      }, 1500);
    });
  }
}, 1000);
