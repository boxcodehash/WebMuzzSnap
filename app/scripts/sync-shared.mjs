import { copyFileSync, mkdirSync } from 'node:fs';

mkdirSync('functions/src', { recursive: true });
copyFileSync('shared/loginMessage.js', 'functions/src/loginMessage.js');
copyFileSync('shared/policy.js', 'functions/src/policy.js');
