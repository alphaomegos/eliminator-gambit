pipeline {
  agent any

  stages {
    stage('Checkout') {
      steps {
        git 'https://github.com/USERNAME/eliminators-gambit.git'
      }
    }

    stage('Build Docker image') {
      steps {
        sh 'docker build -t eliminators-gambit:latest .'
      }
    }

    stage('Deploy') {
      steps {
        sh '''
          docker stop eliminators || true
          docker rm eliminators || true
          docker run -d \
            --name eliminators \
            -p 3000:3000 \
            eliminators-gambit:latest
        '''
      }
    }
  }
}

