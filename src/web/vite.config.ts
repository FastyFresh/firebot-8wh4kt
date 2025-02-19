import { defineConfig } from 'vite'; // ^4.4.0
import react from '@vitejs/plugin-react'; // ^4.0.0
import tsconfigPaths from 'vite-tsconfig-paths'; // ^4.2.0
import { loadEnv } from 'vite';
import type { UserConfig, ConfigEnv } from 'vite';

export default defineConfig(({ mode, command }: ConfigEnv): UserConfig => {
  // Load env variables based on mode
  const env = loadEnv(mode, process.cwd(), '');

  return {
    // Development server configuration
    server: {
      port: 3000,
      host: true,
      strictPort: true,
      cors: true,
      proxy: {
        '/api': {
          target: env.VITE_API_URL,
          changeOrigin: true,
          secure: true,
          rewrite: (path) => path.replace(/^\/api/, ''),
        },
        '/ws': {
          target: env.VITE_WS_URL,
          changeOrigin: true,
          secure: true,
          ws: true,
        },
      },
    },

    // Production build configuration
    build: {
      target: ['chrome90', 'firefox88', 'safari14', 'edge90'],
      outDir: 'dist',
      assetsDir: 'assets',
      sourcemap: true,
      minify: 'terser',
      terserOptions: {
        compress: {
          drop_console: true,
          drop_debugger: true,
        },
      },
      cssCodeSplit: true,
      rollupOptions: {
        output: {
          manualChunks: {
            // Core UI dependencies
            vendor: [
              'react',
              'react-dom',
              '@mui/material',
              '@emotion/react',
              '@emotion/styled'
            ],
            // Trading visualization libraries
            charts: [
              'lightweight-charts',
              'd3'
            ],
            // Blockchain integration
            web3: [
              '@solana/web3.js',
              '@solana/wallet-adapter-react'
            ],
            // Utility libraries
            utils: [
              'date-fns',
              'lodash'
            ],
          },
        },
      },
    },

    // Plugin configuration
    plugins: [
      react({
        fastRefresh: true,
        babel: {
          plugins: ['@emotion/babel-plugin'],
        },
      }),
      tsconfigPaths(),
    ],

    // Path resolution configuration
    resolve: {
      alias: {
        '@': '/src',
        '@components': '/src/components',
        '@hooks': '/src/hooks',
        '@services': '/src/services',
        '@utils': '/src/utils',
        '@styles': '/src/styles',
      },
    },

    // Environment variable configuration
    define: {
      'process.env.NODE_ENV': JSON.stringify(mode),
      'process.env.VITE_APP_VERSION': JSON.stringify(process.env.npm_package_version),
      'process.env.VITE_BUILD_TIME': JSON.stringify(new Date().toISOString()),
    },

    // Dependency optimization
    optimizeDeps: {
      include: [
        'react',
        'react-dom',
        '@mui/material',
        'lightweight-charts',
        '@solana/web3.js',
      ],
      exclude: [
        '@solana/wallet-adapter-react'
      ],
    },

    // Performance optimization for large trading interface
    esbuild: {
      logOverride: { 'this-is-undefined-in-esm': 'silent' },
      target: 'es2020',
    },
  };
});