import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const baseFromHomepage = (() => {
  const homepage = process.env.npm_package_homepage
  if (!homepage) return undefined
  try {
    return new URL(homepage).pathname
  } catch {
    return undefined
  }
})()

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  base: process.env.VITE_BASE_PATH ?? baseFromHomepage ?? '/',
})
