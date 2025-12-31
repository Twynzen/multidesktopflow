import { inject } from '@angular/core';
import { Router, CanActivateFn } from '@angular/router';
import { AuthService } from '../services/auth.service';

export const authGuard: CanActivateFn = () => {
  const authService = inject(AuthService);
  const router = inject(Router);

  // Allow access if authenticated OR in offline mode
  if (authService.canAccessApp()) {
    return true;
  }

  // Wait for auth state to be determined
  if (authService.isLoading()) {
    return new Promise((resolve) => {
      const checkAuth = setInterval(() => {
        if (!authService.isLoading()) {
          clearInterval(checkAuth);
          if (authService.canAccessApp()) {
            resolve(true);
          } else {
            router.navigate(['/login']);
            resolve(false);
          }
        }
      }, 100);
    });
  }

  router.navigate(['/login']);
  return false;
};

export const guestGuard: CanActivateFn = () => {
  const authService = inject(AuthService);
  const router = inject(Router);

  // If already authenticated, redirect to home
  if (authService.isAuthenticated() && !authService.isLoading()) {
    router.navigate(['/']);
    return false;
  }

  return true;
};
