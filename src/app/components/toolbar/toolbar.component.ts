import { Component, Output, EventEmitter, Input, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { ThemeService, ThemeColors } from '../../services/theme.service';
import { AuthService } from '../../services/auth.service';
import { SyncService } from '../../services/sync.service';
import { StorageService } from '../../services/storage.service';
import { MapService } from '../../services/map.service';
import { Desktop } from '../../models/desktop.model';
import { SyncIndicatorComponent } from '../sync-indicator/sync-indicator.component';

@Component({
  selector: 'app-toolbar',
  standalone: true,
  imports: [CommonModule, FormsModule, SyncIndicatorComponent],
  templateUrl: './toolbar.component.html',
  styleUrl: './toolbar.component.scss'
})
export class ToolbarComponent {
  @Input() breadcrumb: Desktop[] = [];
  @Input() currentDesktopId: string = '';
  @Output() addNote = new EventEmitter<void>();
  @Output() addFolder = new EventEmitter<void>();
  @Output() navigateTo = new EventEmitter<string>();
  @Output() exportData = new EventEmitter<void>();
  @Output() importData = new EventEmitter<void>();
  @Output() toggleStructure = new EventEmitter<void>();
  @Output() showVersionHistory = new EventEmitter<void>();
  @Output() importMap = new EventEmitter<File>();

  showThemePicker = signal(false);
  showMenu = signal(false);
  showUserMenu = signal(false);

  constructor(
    public themeService: ThemeService,
    public authService: AuthService,
    public syncService: SyncService,
    private storageService: StorageService,
    private mapService: MapService,
    private router: Router
  ) {}

  get themes() {
    return this.themeService.availableThemes;
  }

  get currentTheme() {
    return this.themeService.currentTheme();
  }

  get glowIntensity() {
    return this.themeService.glowIntensity();
  }

  get userName(): string {
    const user = this.authService.currentUser();
    return user?.displayName || user?.email?.split('@')[0] || 'Usuario';
  }

  selectTheme(theme: ThemeColors): void {
    this.themeService.setTheme(theme);
  }

  setGlowIntensity(value: number): void {
    this.themeService.setGlowIntensity(value);
  }

  onNavigate(desktopId: string): void {
    this.navigateTo.emit(desktopId);
  }

  toggleMenu(): void {
    this.showMenu.update(v => !v);
    if (this.showMenu()) {
      this.showThemePicker.set(false);
      this.showUserMenu.set(false);
    }
  }

  toggleThemePicker(): void {
    this.showThemePicker.update(v => !v);
    if (this.showThemePicker()) {
      this.showMenu.set(false);
      this.showUserMenu.set(false);
    }
  }

  toggleUserMenu(): void {
    this.showUserMenu.update(v => !v);
    if (this.showUserMenu()) {
      this.showMenu.set(false);
      this.showThemePicker.set(false);
    }
  }

  onExport(): void {
    this.showMenu.set(false);
    this.exportData.emit();
  }

  onImport(): void {
    this.showMenu.set(false);
    this.importData.emit();
  }

  onToggleStructure(): void {
    this.showMenu.set(false);
    this.toggleStructure.emit();
  }

  // ==================== NEW METHODS ====================

  async onSaveToCloud(): Promise<void> {
    this.showMenu.set(false);
    await this.syncService.saveToCloud();
  }

  async onLoadFromCloud(): Promise<void> {
    this.showMenu.set(false);
    if (confirm('¿Cargar datos desde la nube? Los cambios locales no guardados se perderán.')) {
      console.log('[Toolbar] 📥 Loading from cloud...');
      const success = await this.syncService.loadFromCloud();

      if (success) {
        console.log('[Toolbar] ✅ Cloud data loaded successfully');
        // Navigate to root desktop instead of reloading the page
        // This prevents auth state loss and black screen issues
        const rootDesktop = this.storageService.desktops().find(d => !d.parentId);
        if (rootDesktop) {
          console.log('[Toolbar] 🏠 Navigating to root desktop:', rootDesktop.id);
          this.navigateTo.emit(rootDesktop.id);
        }
        alert('Datos cargados exitosamente desde la nube.');
      } else {
        console.log('[Toolbar] ⚠️ No cloud data found');
        alert('No se encontraron datos en la nube para este usuario. Usa "Guardar en la nube" primero para crear una copia de seguridad.');
      }
    }
  }

  onShowVersionHistory(): void {
    this.showMenu.set(false);
    this.showVersionHistory.emit();
  }

  async onExportAsMap(): Promise<void> {
    this.showMenu.set(false);
    if (this.currentDesktopId) {
      try {
        await this.mapService.downloadMap(this.currentDesktopId);
      } catch (error) {
        console.error('Error exporting map:', error);
        alert('Error al exportar el mapa');
      }
    }
  }

  onImportMapClick(): void {
    this.showMenu.set(false);
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.mdflow,.json';
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (file) {
        this.importMap.emit(file);
      }
    };
    input.click();
  }

  async onSignOut(): Promise<void> {
    this.showUserMenu.set(false);
    await this.authService.signOut();
    this.router.navigate(['/login']);
  }

  closeAllMenus(): void {
    this.showMenu.set(false);
    this.showThemePicker.set(false);
    this.showUserMenu.set(false);
  }
}
