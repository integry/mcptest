#!/bin/bash

# Deploy CORS Proxy Worker

echo "🚀 Deploying CORS Proxy Worker..."

# Change to worker directory
cd "$(dirname "$0")"

# Install dependencies if needed
if [ ! -d "node_modules" ]; then
    echo "📦 Installing dependencies..."
    npm install
fi

# Deploy the worker
echo "☁️ Deploying to Cloudflare..."
npm run deploy

echo "✅ Deployment complete!"
echo ""
echo "📝 Next steps:"
echo "1. Copy the deployed worker URL from above"
echo "2. Update VITE_PROXY_URL in your .env file with this URL"
echo "3. Restart your development server to apply the changes"