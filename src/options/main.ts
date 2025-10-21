import App from './App.svelte';

const target = document.getElementById('app');
if (!target) throw new Error('No #app element found');

export default new App({ target });
