@echo off
echo 🚀 AgriHub Project Startup Script
echo =================================
echo.
echo 📁 Current location: %CD%
echo.
echo 🔍 Checking project structure...
echo.

REM Check if this is a Node.js project
if exist "package.json" (
    echo ✅ Found package.json - AgriHub Platform detected
    echo.
    echo 📋 Available options:
    echo 1. Start with Docker (Recommended)
    echo 2. Start API only
    echo 3. Start Web only
    echo 4. Install dependencies
    echo 5. View project info
    echo.
    set /p choice="Enter your choice (1-5): "
    
    if "%choice%"=="1" (
        echo 🐳 Starting with Docker...
        echo 📦 This will start PostgreSQL, Redis, API, and Web services
        echo.
        docker-compose up --build
    )
    
    if "%choice%"=="2" (
        echo 🚀 Starting API server...
        cd apps/api
        echo 📦 Installing dependencies...
        call npm install
        echo.
        echo 🚀 Starting API server...
        call npm run start:dev
    )
    
    if "%choice%"=="3" (
        echo 🌐 Starting Web application...
        cd apps/web
        echo 📦 Installing dependencies...
        call npm install
        echo.
        echo 🌐 Starting Web application...
        call npm run dev
    )
    
    if "%choice%"=="4" (
        echo 📦 Installing all dependencies...
        call npm install
        cd apps/api
        call npm install
        cd ..\web
        call npm install
        echo ✅ All dependencies installed!
    )
    
    if "%choice%"=="5" (
        echo.
        echo 📋 AgriHub Platform Information:
        echo ================================
        echo.
        echo 🎯 Project: End-to-end agricultural platform
        echo 🏗️  Architecture: Monorepo with NestJS API + Next.js Web
        echo 🗄️  Database: PostgreSQL with Redis cache
        echo 💳 Payments: Razorpay integration
        echo 📱 Features: Equipment rental, product sales, transport booking
        echo.
        echo 🚀 Quick Start:
        echo 1. Copy env.example to .env in apps/api/
        echo 2. Configure your environment variables
        echo 3. Run option 1 (Docker) for full setup
        echo.
        echo 🌐 Access URLs:
        echo    - Web App: http://localhost:3000
        echo    - API: http://localhost:8000
        echo    - API Docs: http://localhost:8000/api/docs
        echo.
        echo 📚 Documentation: See README.md for detailed setup
        echo.
    )
) else (
    echo ❌ No package.json found
    echo.
    echo 📋 This appears to be a project template
    echo.
    echo 🛠️  To get started:
    echo 1. Initialize your API project in apps/api/
    echo 2. Initialize your web project in apps/web/
    echo 3. Create package.json files for each app
    echo 4. Install dependencies
    echo 5. Run this script again
    echo.
    echo 💡 Example commands:
    echo    cd apps/api
    echo    npm init -y
    echo    npm install express
    echo.
    echo    cd apps/web
    echo    npm init -y
    echo    npm install react
    echo.
)

echo.
echo 🌐 If the project is running, you can access it at:
echo    - Web App: http://localhost:3000
echo    - API: http://localhost:8000
echo    - API Documentation: http://localhost:8000/api/docs
echo.
pause
