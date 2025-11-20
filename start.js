#!/usr/bin/env node

/**
 * Unified startup script for Sentry
 * Runs backend (FastAPI) and dashboard (website) concurrently
 * Note: Browser extension runs separately in Chrome/Edge
 */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

// Colors for console output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

// Check if .env file exists in backend
const backendEnvPath = path.join(__dirname, 'backend', '.env');
if (!fs.existsSync(backendEnvPath)) {
  log('⚠️  Warning: .env file not found in backend directory', 'yellow');
  log('   Please create backend/.env with GEMINI_API_KEY=your_key', 'yellow');
  log('   The backend will fail to start without it.\n', 'yellow');
}

// Check if node_modules exists in dashboard
const dashboardNodeModules = path.join(__dirname, 'website', 'node_modules');

const needsDashboardInstall = !fs.existsSync(dashboardNodeModules);

let installationsComplete = 0;
const totalInstallations = (needsDashboardInstall ? 1 : 0);

function checkAndInstall(callback) {
  if (totalInstallations === 0) {
    callback();
    return;
  }

  // Install dashboard if needed
  if (needsDashboardInstall) {
    log('⚠️  Dashboard dependencies not installed. Installing...', 'yellow');
    const dashboardInstall = spawn('npm', ['install'], {
      cwd: path.join(__dirname, 'website'),
      stdio: 'inherit',
      shell: true
    });

    dashboardInstall.on('close', (code) => {
      if (code !== 0) {
        log('❌ Dashboard installation failed', 'red');
        process.exit(1);
      }
      installationsComplete++;
      if (installationsComplete === totalInstallations) {
        callback();
      }
    });
  }
}

checkAndInstall(startServices);

function startServices() {
  log('\n🚀 Starting Sentry Backend and Dashboard...\n', 'bright');
  log('   (Browser extension will run separately in Chrome/Edge)\n', 'yellow');

  // Start Backend (FastAPI)
  log('📡 Starting Backend Server (FastAPI on http://localhost:8000)...', 'cyan');
  const backend = spawn('python', ['-m', 'uvicorn', 'app.main:app', '--host', '0.0.0.0', '--port', '8000', '--reload'], {
    cwd: path.join(__dirname, 'backend'),
    stdio: 'inherit',
    shell: true
  });

  backend.on('error', (err) => {
    log(`❌ Backend failed to start: ${err.message}`, 'red');
    log('   Make sure Python and uvicorn are installed:', 'yellow');
    log('   pip install -r backend/requirements.txt', 'yellow');
    process.exit(1);
  });

  // Start Dashboard (Website)
  log('📊 Starting Dashboard (Website)...', 'blue');
  const dashboard = spawn('npm', ['run', 'dev'], {
    cwd: path.join(__dirname, 'website'),
    stdio: 'inherit',
    shell: true
  });

  dashboard.on('error', (err) => {
    log(`❌ Dashboard failed to start: ${err.message}`, 'red');
    log('   Make sure dependencies are installed:', 'yellow');
    log('   cd website && npm install', 'yellow');
    process.exit(1);
  });

  // Handle process termination
  process.on('SIGINT', () => {
    log('\n\n🛑 Shutting down services...', 'yellow');
    backend.kill();
    dashboard.kill();
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    log('\n\n🛑 Shutting down services...', 'yellow');
    backend.kill();
    dashboard.kill();
    process.exit(0);
  });

  log('\n✅ All services are starting...', 'green');
  log('   Backend:  http://localhost:8000', 'cyan');
  log('   Dashboard: Check the Vite output above for the dashboard URL', 'blue');
  log('\n   Press Ctrl+C to stop all services\n', 'yellow');
}


