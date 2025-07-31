#!/bin/bash

# Cloudflare Worker Deployment Script
# This script loads configuration from environment variables and deploys the worker

set -e

# Color codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Function to print colored output
print_message() {
    local color=$1
    local message=$2
    echo -e "${color}${message}${NC}"
}

# Check if required environment variables are set
check_env_vars() {
    local missing_vars=()
    
    # Required environment variables
    local required_vars=(
        "CLOUDFLARE_ACCOUNT_ID"
        "CLOUDFLARE_API_TOKEN"
        "FIREBASE_PROJECT_ID"
    )
    
    for var in "${required_vars[@]}"; do
        if [ -z "${!var}" ]; then
            missing_vars+=("$var")
        fi
    done
    
    if [ ${#missing_vars[@]} -ne 0 ]; then
        print_message $RED "Error: Missing required environment variables:"
        for var in "${missing_vars[@]}"; do
            echo "  - $var"
        done
        echo ""
        echo "Please set the following environment variables:"
        echo "  export CLOUDFLARE_ACCOUNT_ID=your-account-id"
        echo "  export CLOUDFLARE_API_TOKEN=your-api-token"
        echo "  export FIREBASE_PROJECT_ID=your-firebase-project-id"
        echo ""
        echo "Optional environment variables:"
        echo "  export WORKER_NAME=mcptest-state-api (default: mcptest-state-api)"
        echo "  export WORKER_ENV=production (default: production)"
        exit 1
    fi
}

# Set default values for optional environment variables
WORKER_NAME="${WORKER_NAME:-mcptest-state-api}"
WORKER_ENV="${WORKER_ENV:-production}"

# Create temporary wrangler.toml with environment variables
create_temp_config() {
    local temp_config="wrangler.temp.toml"
    
    cat > "$temp_config" << EOF
name = "${WORKER_NAME}"
main = "src/index.js"
compatibility_date = "$(date +%Y-%m-%d)"
account_id = "${CLOUDFLARE_ACCOUNT_ID}"

[vars]
FIREBASE_PROJECT_ID = "${FIREBASE_PROJECT_ID}"

[durable_objects]
bindings = [
  { name = "USER_STATE", class_name = "UserState" }
]

[[migrations]]
tag = "v1"
new_classes = ["UserState"]

EOF

    if [ "$WORKER_ENV" != "production" ]; then
        echo "" >> "$temp_config"
        echo "[env.${WORKER_ENV}]" >> "$temp_config"
        echo "name = \"${WORKER_NAME}-${WORKER_ENV}\"" >> "$temp_config"
    fi
    
    echo "$temp_config"
}

# Main deployment function
deploy_worker() {
    print_message $YELLOW "Starting Cloudflare Worker deployment..."
    echo ""
    
    # Check if we're in the correct directory
    if [ ! -f "src/index.js" ] || [ ! -f "src/UserState.js" ]; then
        print_message $RED "Error: Cannot find worker source files."
        echo "Please run this script from the cloudflare-worker directory."
        exit 1
    fi
    
    # Check for wrangler installation
    if ! command -v wrangler &> /dev/null; then
        print_message $RED "Error: wrangler CLI is not installed."
        echo "Please install wrangler with: npm install -g wrangler"
        exit 1
    fi
    
    # Check environment variables
    check_env_vars
    
    # Display deployment information
    print_message $GREEN "Deployment Configuration:"
    echo "  Worker Name: ${WORKER_NAME}"
    echo "  Environment: ${WORKER_ENV}"
    echo "  Account ID: ${CLOUDFLARE_ACCOUNT_ID:0:8}..."
    echo "  Firebase Project: ${FIREBASE_PROJECT_ID}"
    echo ""
    
    # Create temporary config file
    local temp_config=$(create_temp_config)
    print_message $YELLOW "Created temporary configuration file: ${temp_config}"
    
    # Set up Cloudflare authentication
    export CLOUDFLARE_API_TOKEN
    
    # Deploy the worker
    print_message $YELLOW "Deploying worker to Cloudflare..."
    
    if [ "$WORKER_ENV" = "production" ]; then
        wrangler deploy --config "$temp_config"
    else
        wrangler deploy --env "$WORKER_ENV" --config "$temp_config"
    fi
    
    local deploy_status=$?
    
    # Clean up temporary config file
    rm -f "$temp_config"
    
    if [ $deploy_status -eq 0 ]; then
        print_message $GREEN "✓ Worker deployed successfully!"
        echo ""
        echo "Worker Details:"
        echo "  Name: ${WORKER_NAME}"
        if [ "$WORKER_ENV" != "production" ]; then
            echo "  Environment: ${WORKER_ENV}"
            echo "  URL: https://${WORKER_NAME}-${WORKER_ENV}.<your-subdomain>.workers.dev"
        else
            echo "  URL: https://${WORKER_NAME}.<your-subdomain>.workers.dev"
        fi
        echo ""
        echo "To view logs:"
        echo "  wrangler tail ${WORKER_NAME}"
    else
        print_message $RED "✗ Deployment failed!"
        exit 1
    fi
}

# Script entry point
main() {
    print_message $GREEN "=== Cloudflare Worker Deployment Script ==="
    echo ""
    
    # Handle help flag
    if [ "$1" = "-h" ] || [ "$1" = "--help" ]; then
        echo "Usage: $0 [options]"
        echo ""
        echo "Options:"
        echo "  -h, --help    Show this help message"
        echo ""
        echo "Required Environment Variables:"
        echo "  CLOUDFLARE_ACCOUNT_ID    Your Cloudflare account ID"
        echo "  CLOUDFLARE_API_TOKEN     Your Cloudflare API token"
        echo "  FIREBASE_PROJECT_ID      Your Firebase project ID"
        echo ""
        echo "Optional Environment Variables:"
        echo "  WORKER_NAME             Worker name (default: mcptest-state-api)"
        echo "  WORKER_ENV              Deployment environment (default: production)"
        echo ""
        echo "Example:"
        echo "  export CLOUDFLARE_ACCOUNT_ID=abc123"
        echo "  export CLOUDFLARE_API_TOKEN=your-token"
        echo "  export FIREBASE_PROJECT_ID=your-project"
        echo "  ./deploy.sh"
        exit 0
    fi
    
    # Deploy the worker
    deploy_worker
}

# Run the script
main "$@"