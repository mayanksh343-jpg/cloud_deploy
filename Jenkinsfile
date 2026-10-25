pipeline {
    agent any
    options {
        timestamps()
        disableConcurrentBuilds()
        buildDiscarder(logRotator(numToKeepStr: '20'))
    }
    parameters {
        string(name: 'REPO_URL', defaultValue: 'https://github.com/mayanksh343-jpg/cloud_deploy', description: 'Public HTTPS GitHub repository URL')
        string(name: 'BRANCH', defaultValue: 'main', description: 'Branch to build')
        choice(name: 'DEPLOY_TARGET', choices: ['local', 'aws'], description: 'Deployment target')
    }
    environment {
        IMAGE_NAME = 'clouddeploy-user-app'
        CONTAINER_NAME = 'clouddeploy-user-app'
        APP_PORT = '5001'
        APP_CONTAINER_PORT = '5000'
    }
    stages {
        stage('Validate input') {
            steps {
                script {
                    if (!(params.REPO_URL ==~ 'https://github\\.com/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+(\\.git)?/?')) {
                        error('Only public HTTPS GitHub repository URLs in owner/repo form are allowed.')
                    }
                    if (!(params.BRANCH ==~ '[A-Za-z0-9][A-Za-z0-9._/-]{0,127}') || params.BRANCH.contains('..') || params.BRANCH.contains('//') || params.BRANCH.endsWith('/')) {
                        error('Invalid branch name.')
                    }
                }
            }
        }
        stage('Checkout repository') {
            steps {
                dir('source') {
                    deleteDir()
                    git branch: params.BRANCH, url: params.REPO_URL
                }
                sh 'test -d source && echo "Repository checkout completed"'
            }
        }
        stage('Test application') {
            steps {
                sh '''
                    set -eu
                    if [ -f source/Dockerfile ]; then
                        APP_DIR="."
                    elif [ -f source/sample-app/Dockerfile ]; then
                        APP_DIR="sample-app"
                    else
                        DOCKERFILE=$(find source -mindepth 2 -maxdepth 4 -name Dockerfile -print -quit)
                        if [ -z "$DOCKERFILE" ]; then
                            echo "No Dockerfile found at repository root or in a subdirectory."
                            exit 1
                        fi
                        APP_DIR=$(dirname "$DOCKERFILE")
                        APP_DIR=$(printf '%s' "$APP_DIR" | sed 's#^source/##')
                    fi
                    echo "$APP_DIR" > source/.clouddeploy-app-dir
                    echo "Application directory: $APP_DIR"
                    if [ -f "source/$APP_DIR/requirements.txt" ] && find "source/$APP_DIR" -maxdepth 2 -type f -name 'test*.py' -print -quit | grep -q .; then
                        python3 -m venv source/.venv
                        source/.venv/bin/python -m pip install --upgrade pip
                        source/.venv/bin/python -m pip install -r "source/$APP_DIR/requirements.txt"
                        source/.venv/bin/python -m unittest discover -s "source/$APP_DIR" -p 'test*.py' -v
                    else
                        echo "No supported Python unittest suite detected; skipping automatic unit tests."
                    fi
                '''
            }
        }
        stage('Build Docker image') {
            steps {
                sh '''
                    set -eu
                    APP_DIR=$(cat source/.clouddeploy-app-dir)
                    docker build -t "$IMAGE_NAME:$BUILD_NUMBER" "source/$APP_DIR"
                    docker tag "$IMAGE_NAME:$BUILD_NUMBER" "$IMAGE_NAME:latest"
                '''
            }
        }
        stage('Deploy locally') {
            when { expression { params.DEPLOY_TARGET == 'local' } }
            steps {
                sh '''
                    set -eu
                    docker rm -f "$CONTAINER_NAME" 2>/dev/null || true
                    docker run -d --name "$CONTAINER_NAME" -p "$APP_PORT:$APP_CONTAINER_PORT" "$IMAGE_NAME:$BUILD_NUMBER"
                    echo "Container started. APP_CONTAINER_PORT defaults to 5000."
                '''
            }
        }
        stage('Deploy to AWS ECS') {
            when { expression { params.DEPLOY_TARGET == 'aws' } }
            steps {
                sh '''
                    set -eo pipefail
                    if [ -z "$AWS_REGION" ] || [ -z "$ECR_REPOSITORY" ] || [ -z "$ECS_CLUSTER" ] || [ -z "$ECS_SERVICE" ]; then
                        echo "Set AWS_REGION, ECR_REPOSITORY, ECS_CLUSTER, and ECS_SERVICE in the Jenkins agent environment."
                        exit 1
                    fi
                    command -v aws >/dev/null 2>&1 || { echo "AWS CLI is required on the Jenkins agent."; exit 1; }
                    ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
                    REGISTRY="$ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com"
                    IMAGE_URI="$REGISTRY/$ECR_REPOSITORY"
                    aws ecr describe-repositories --repository-names "$ECR_REPOSITORY" --region "$AWS_REGION" >/dev/null
                    aws ecr get-login-password --region "$AWS_REGION" | docker login --username AWS --password-stdin "$REGISTRY"
                    docker tag "$IMAGE_NAME:$BUILD_NUMBER" "$IMAGE_URI:$BUILD_NUMBER"
                    docker tag "$IMAGE_NAME:$BUILD_NUMBER" "$IMAGE_URI:latest"
                    docker push "$IMAGE_URI:$BUILD_NUMBER"
                    docker push "$IMAGE_URI:latest"
                    echo "Updating ECS service. Its task definition must reference $IMAGE_URI:latest."
                    aws ecs update-service --cluster "$ECS_CLUSTER" --service "$ECS_SERVICE" --force-new-deployment --region "$AWS_REGION" >/dev/null
                    aws ecs wait services-stable --cluster "$ECS_CLUSTER" --services "$ECS_SERVICE" --region "$AWS_REGION"
                    echo "ECS service reached stable state."
                '''
            }
        }
        stage('Verify local deployment') {
            when { expression { params.DEPLOY_TARGET == 'local' } }
            steps {
                sh '''
                    set -eu
                    for i in $(seq 1 15); do
                        if python3 -c "import urllib.request; urllib.request.urlopen('http://localhost:$APP_PORT/health', timeout=2)"; then
                            echo "Health check passed at http://localhost:$APP_PORT/health"
                            exit 0
                        fi
                        sleep 2
                    done
                    docker logs "$CONTAINER_NAME" || true
                    echo "Health check failed. This generic check expects a /health endpoint."
                    exit 1
                '''
            }
        }
    }
    post {
        success { echo 'CloudDeploy pipeline completed. Check the selected repository, branch, target, and build result above.' }
        failure { echo 'Pipeline failed. Open the Jenkins console output for the exact failing stage.' }
    }
}
