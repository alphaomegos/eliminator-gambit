pipeline {
  agent any

  options {
    timestamps()
  }

  environment {
    // Will be set in "Detect Compose"
    COMPOSE = ""
  }

  stages {
    stage('Checkout') {
      steps {
        checkout scm
      }
    }

    stage('Detect Compose') {
      steps {
        script {
          env.COMPOSE = sh(
            script: 'docker compose version >/dev/null 2>&1 && echo "docker compose" || echo "docker-compose"',
            returnStdout: true
          ).trim()
        }
      }
    }

    stage('Unit tests') {
      steps {
        sh 'make COMPOSE="$COMPOSE" test'
      }
    }

    stage('Integration tests') {
      steps {
        sh 'make COMPOSE="$COMPOSE" itest'
      }
    }

    stage('Deploy') {
      when {
        branch 'main'
      }
      steps {
        sh '''
          set -e
          $COMPOSE up -d --no-deps --force-recreate api web
        '''
      }
    }
  }
}
