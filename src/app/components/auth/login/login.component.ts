import { Component, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../../../services/auth.service';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './login.component.html',
  styleUrl: './login.component.scss'
})
export class LoginComponent {
  email = '';
  password = '';
  error = signal<string>('');
  isLoading = signal<boolean>(false);
  showPassword = signal<boolean>(false);

  constructor(
    private authService: AuthService,
    private router: Router
  ) {
    // If already authenticated, redirect to desktop
    if (this.authService.isAuthenticated()) {
      this.router.navigate(['/']);
    }
  }

  async onSubmit(): Promise<void> {
    if (!this.email || !this.password) {
      this.error.set('Por favor completa todos los campos');
      return;
    }

    this.isLoading.set(true);
    this.error.set('');

    const result = await this.authService.signIn(this.email, this.password);

    this.isLoading.set(false);

    if (result.success) {
      this.router.navigate(['/']);
    } else {
      this.error.set(result.error || 'Error al iniciar sesión');
    }
  }

  togglePassword(): void {
    this.showPassword.update(v => !v);
  }

  async continueOffline(): Promise<void> {
    this.isLoading.set(true);
    await this.authService.continueOffline();
    this.isLoading.set(false);
    this.router.navigate(['/']);
  }

  isOfflineMode(): boolean {
    return this.authService.isOfflineMode();
  }
}
