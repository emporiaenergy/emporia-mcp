/**
 * Type definitions for authentication-related interfaces
 */

/**
 * Authentication credentials for connecting to AWS Cognito
 */
export interface AuthCredentials {
  account_email: string;
  password: string;
  clientId: string;
  cognitoUrl: string;
}

/**
 * Response object containing authentication tokens
 */
export interface TokenResponse {
  accessToken: string;
  idToken: string;
}

/**
 * Response structure from AWS Cognito authentication API
 */
export interface CognitoAuthResult {
  AuthenticationResult: {
    AccessToken: string;
    IdToken: string;
    RefreshToken?: string;
    /**
     * Number of seconds until expiration.
     */
    ExpiresIn: number;
  };
}
