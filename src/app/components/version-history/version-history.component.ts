import { Component, signal, computed, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { VersionService } from '../../services/version.service';
import { Version } from '../../models/database.model';

@Component({
  selector: 'app-version-history',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="version-history-overlay" (click)="close()">
      <div class="version-history-panel" (click)="$event.stopPropagation()">
        <div class="panel-header">
          <h2>
            <svg class="header-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="10"/>
              <polyline points="12 6 12 12 16 14"/>
            </svg>
            Historial de Versiones
          </h2>
          <button class="close-btn" (click)="close()">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="18" y1="6" x2="6" y2="18"/>
              <line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        <div class="panel-content">
          @if (loading()) {
            <div class="loading">
              <span class="spinner"></span>
              Cargando historial...
            </div>
          } @else if (versions().length === 0) {
            <div class="empty">
              <svg class="empty-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/>
                <path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>
              </svg>
              <p>No hay versiones guardadas</p>
              <small>Guarda tu primera partida para crear un punto de restauración</small>
            </div>
          } @else {
            <div class="version-list">
              @for (version of versions(); track version.id) {
                <div
                  class="version-item"
                  [class.current]="version.versionNumber === currentVersion()"
                >
                  <div class="version-info">
                    <span class="version-number">v{{ version.versionNumber }}</span>
                    <span class="version-date">{{ formatDate(version.createdAt) }}</span>
                  </div>
                  <p class="version-summary">{{ version.changeSummary }}</p>
                  <div class="version-actions">
                    @if (version.versionNumber !== currentVersion()) {
                      <button
                        class="restore-btn"
                        (click)="restoreVersion(version)"
                        [disabled]="restoring()"
                      >
                        ↩ Restaurar
                      </button>
                    } @else {
                      <span class="current-badge">Actual</span>
                    }
                  </div>
                </div>
              }
            </div>
          }
        </div>

        @if (message()) {
          <div class="message" [class]="messageType()">
            {{ message() }}
          </div>
        }
      </div>
    </div>
  `,
  styles: [`
    .version-history-overlay {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.7);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 1000;
      backdrop-filter: blur(4px);
    }

    .version-history-panel {
      background: rgba(15, 20, 25, 0.98);
      border: 1px solid var(--primary-color, #0d7337);
      border-radius: 8px;
      width: 90%;
      max-width: 500px;
      max-height: 80vh;
      display: flex;
      flex-direction: column;
      box-shadow:
        0 0 30px rgba(var(--primary-rgb, 13, 115, 55), 0.3),
        inset 0 0 30px rgba(0, 0, 0, 0.5);
    }

    .panel-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 1rem 1.25rem;
      border-bottom: 1px solid rgba(255, 255, 255, 0.1);

      h2 {
        margin: 0;
        font-size: 1.1rem;
        color: #e0e0e0;
        display: flex;
        align-items: center;
        gap: 0.5rem;

        .header-icon {
          width: 20px;
          height: 20px;
          color: var(--primary-color, #0d7337);
        }
      }

      .close-btn {
        background: none;
        border: none;
        color: #888;
        cursor: pointer;
        padding: 0.25rem;
        transition: color 0.2s;
        display: flex;
        align-items: center;

        svg {
          width: 18px;
          height: 18px;
        }

        &:hover {
          color: #fff;
        }
      }
    }

    .panel-content {
      flex: 1;
      overflow-y: auto;
      padding: 1rem;
    }

    .loading {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 0.75rem;
      padding: 2rem;
      color: #888;

      .spinner {
        width: 20px;
        height: 20px;
        border: 2px solid rgba(255, 255, 255, 0.1);
        border-top-color: var(--primary-color, #0d7337);
        border-radius: 50%;
        animation: spin 0.8s linear infinite;
      }
    }

    .empty {
      text-align: center;
      padding: 2rem;
      color: #888;
      display: flex;
      flex-direction: column;
      align-items: center;

      .empty-icon {
        width: 48px;
        height: 48px;
        margin-bottom: 0.75rem;
        opacity: 0.5;
      }

      p {
        margin: 0 0 0.5rem;
        color: #aaa;
      }

      small {
        color: #666;
      }
    }

    .version-list {
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
    }

    .version-item {
      background: rgba(0, 0, 0, 0.3);
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 6px;
      padding: 0.875rem;
      transition: all 0.2s;

      &:hover {
        border-color: rgba(var(--primary-rgb, 13, 115, 55), 0.4);
      }

      &.current {
        border-color: var(--primary-color, #0d7337);
        background: rgba(var(--primary-rgb, 13, 115, 55), 0.1);
      }
    }

    .version-info {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      margin-bottom: 0.5rem;
    }

    .version-number {
      font-weight: 600;
      color: var(--primary-color, #0d7337);
      font-size: 0.95rem;
    }

    .version-date {
      color: #888;
      font-size: 0.8rem;
    }

    .version-summary {
      margin: 0 0 0.75rem;
      color: #aaa;
      font-size: 0.85rem;
    }

    .version-actions {
      display: flex;
      justify-content: flex-end;
    }

    .restore-btn {
      background: transparent;
      border: 1px solid var(--primary-color, #0d7337);
      color: var(--primary-color, #0d7337);
      padding: 0.4rem 0.75rem;
      border-radius: 4px;
      font-size: 0.8rem;
      cursor: pointer;
      transition: all 0.2s;

      &:hover:not(:disabled) {
        background: rgba(var(--primary-rgb, 13, 115, 55), 0.2);
      }

      &:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }
    }

    .current-badge {
      background: rgba(var(--primary-rgb, 13, 115, 55), 0.2);
      color: var(--primary-color, #0d7337);
      padding: 0.35rem 0.75rem;
      border-radius: 4px;
      font-size: 0.75rem;
      font-weight: 500;
    }

    .message {
      padding: 0.75rem 1.25rem;
      border-top: 1px solid rgba(255, 255, 255, 0.1);
      font-size: 0.85rem;
      text-align: center;

      &.success {
        color: var(--primary-color, #0d7337);
        background: rgba(var(--primary-rgb, 13, 115, 55), 0.1);
      }

      &.error {
        color: #ff4444;
        background: rgba(255, 68, 68, 0.1);
      }
    }

    @keyframes spin {
      to { transform: rotate(360deg); }
    }
  `]
})
export class VersionHistoryComponent {
  closed = output<void>();

  restoring = signal(false);
  message = signal('');
  messageType = signal<'success' | 'error'>('success');

  readonly versions = computed(() => this.versionService.versionHistory());
  readonly loading = computed(() => this.versionService.loading());
  readonly currentVersion = computed(() => this.versionService.currentVersion());

  constructor(private versionService: VersionService) {
    this.loadHistory();
  }

  async loadHistory(): Promise<void> {
    await this.versionService.loadVersionHistory();
  }

  formatDate(date: Date): string {
    return this.versionService.formatDate(date);
  }

  async restoreVersion(version: Version): Promise<void> {
    if (!confirm(`¿Restaurar a la versión ${version.versionNumber}? Los cambios no guardados se perderán.`)) {
      return;
    }

    this.restoring.set(true);
    this.message.set('');

    try {
      const success = await this.versionService.restoreVersion(version.id);
      if (success) {
        this.message.set(`Versión ${version.versionNumber} restaurada. Recargando...`);
        this.messageType.set('success');
        setTimeout(() => {
          window.location.reload();
        }, 1500);
      } else {
        this.message.set('Error al restaurar la versión');
        this.messageType.set('error');
      }
    } catch (error) {
      this.message.set('Error al restaurar la versión');
      this.messageType.set('error');
    } finally {
      this.restoring.set(false);
    }
  }

  close(): void {
    this.closed.emit();
  }
}
