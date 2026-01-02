import { inject } from '@angular/core';
import { Router, CanActivateFn } from '@angular/router';
import { AuthService } from '../services/auth.service';

const AUTH_TIMEOUT_MS = 10000; // 10 seconds max wait
const AUTH_CHECK_INTERVAL_MS = 100;

export const authGuard: CanActivateFn = () => {
  const authService = inject(AuthService);
  const router = inject(Router);

  console.log('[AuthGuard] 🛡️ Checking access...', {
    isLoading: authService.isLoading(),
    isAuthenticated: authService.isAuthenticated(),
    canAccessApp: authService.canAccessApp()
  });

  // Allow access if authenticated OR in offline mode
  if (authService.canAccessApp()) {
    console.log('[AuthGuard] ✅ Access granted immediately');
    return true;
  }

  // Wait for auth state to be determined (with timeout)
  if (authService.isLoading()) {
    console.log('[AuthGuard] ⏳ Auth is loading, waiting...');

    return new Promise((resolve) => {
      const startTime = Date.now();
      let checkCount = 0;

      const checkAuth = setInterval(() => {
        checkCount++;
        const elapsed = Date.now() - startTime;

        // Log every 1 second
        if (checkCount % 10 === 0) {
          console.log(`[AuthGuard] ⏳ Still waiting... (${elapsed}ms)`, {
            isLoading: authService.isLoading(),
            isAuthenticated: authService.isAuthenticated()
          });
        }

        // Timeout protection
        if (elapsed >= AUTH_TIMEOUT_MS) {
          clearInterval(checkAuth);
          console.error(`[AuthGuard] ❌ TIMEOUT after ${AUTH_TIMEOUT_MS}ms! Redirecting to login.`);
          console.log('[AuthGuard] 📊 Final state:', {
            isLoading: authService.isLoading(),
            isAuthenticated: authService.isAuthenticated(),
            canAccessApp: authService.canAccessApp()
          });
          router.navigate(['/login']);
          resolve(false);
          return;
        }

        // Normal check
        if (!authService.isLoading()) {
          clearInterval(checkAuth);
          console.log(`[AuthGuard] 🏁 Loading completed after ${elapsed}ms`);

          if (authService.canAccessApp()) {
            console.log('[AuthGuard] ✅ Access granted after wait');
            resolve(true);
          } else {
            console.log('[AuthGuard] 🚫 Access denied, redirecting to login');
            router.navigate(['/login']);
            resolve(false);
          }
        }
      }, AUTH_CHECK_INTERVAL_MS);
    });
  }

  console.log('[AuthGuard] 🚫 Not authenticated and not loading, redirecting to login');
  router.navigate(['/login']);
  return false;
};

export const guestGuard: CanActivateFn = () => {
  const authService = inject(AuthService);
  const router = inject(Router);

  console.log('[GuestGuard] 🚪 Checking guest access...', {
    isLoading: authService.isLoading(),
    isAuthenticated: authService.isAuthenticated()
  });

  // If already authenticated, redirect to home
  if (authService.isAuthenticated() && !authService.isLoading()) {
    console.log('[GuestGuard] 🔄 Already authenticated, redirecting to home');
    router.navigate(['/']);
    return false;
  }

  console.log('[GuestGuard] ✅ Guest access granted');
  return true;
};
