
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
                bat 'dir sample-app'
            }
        }

        stage('Test') {
            steps {
                dir('sample-app') {
                    bat '''
                        python -m pip install -r requirements.txt
                        python -m unittest -v test_app.py
                    '''
                }
            }
        }

        stage('Build Docker Image') {
            steps {
                bat 'docker build -t %IMAGE_NAME%:latest sample-app'
            }
        }

        stage('Deploy') {
            steps {
                bat '''
                    docker rm -f %CONTAINER_NAME% 2>nul
                    if errorlevel 1 exit /b 1
                    docker run -d --name %CONTAINER_NAME% -p %APP_PORT%:5000 %IMAGE_NAME%:latest
                '''
            }
        }

        stage('Verify') {
            steps {
                bat '''
                    powershell -NoProfile -Command "$ok=$false; for($i=0;$i -lt 15;$i++){try{$r=Invoke-RestMethod http://localhost:5000/health -TimeoutSec 2; if($r.status -eq 'healthy'){$ok=$true;break}}catch{}; Start-Sleep -Seconds 2}; if(-not $ok){docker logs %CONTAINER_NAME%; exit 1}; Write-Host 'Health check passed'"
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
