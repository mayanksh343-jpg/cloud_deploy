
pipeline {
    agent any

    options {
        timestamps()
    }

    environment {
        IMAGE_NAME = 'clouddeploy-app'
        CONTAINER_NAME = 'clouddeploy-test'
        APP_PORT = '5000'
    }

    stages {
        stage('Build') {
            steps {
                echo 'Checking application files...'
                sh 'ls -la sample-app'
            }
        }

        
stage('Test') {
    steps {
        dir('sample-app') {
            sh '''
                python3 -m venv .venv
                .venv/bin/python -m pip install --upgrade pip
                .venv/bin/python -m pip install -r requirements.txt
                .venv/bin/python -m unittest -v test_app.py
            '''
        }
    }
}


        stage('Build Docker Image') {
            steps {
                sh 'docker build -t ${IMAGE_NAME}:latest sample-app'
            }
        }

        stage('Deploy') {
            steps {
                sh '''
                    docker rm -f "$CONTAINER_NAME" || true
                    docker run -d \
                        --name "$CONTAINER_NAME" \
                        -p "$APP_PORT":5000 \
                        "$IMAGE_NAME":latest
                '''
            }
        }

        stage('Verify') {
            steps {
                sh '''
                    for i in $(seq 1 15); do
                        if python3 -c "import urllib.request; print(urllib.request.urlopen('http://localhost:${APP_PORT}/health', timeout=2).read().decode())"; then
                            echo "Health check passed"
                            exit 0
                        fi
                        sleep 2
                    done

                    docker logs "$CONTAINER_NAME" || true
                    echo "Health check failed"
                    exit 1
                '''
            }
        }
    }

    post {
        success {
            echo 'CloudDeploy deployment succeeded!'
        }
        failure {
            echo 'Pipeline failed. Check the stage logs.'
        }
    }
}
