import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// base './' so the built app also works from GitHub Pages or a plain folder.
export default defineConfig({ plugins: [react()], base: './' })
