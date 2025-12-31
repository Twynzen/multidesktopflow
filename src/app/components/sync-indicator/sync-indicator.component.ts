import { Component, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { SyncService } from '../../services/sync.service';
import { AuthService } from '../../services/auth.service';

@Component({
  selector: 'app-sync-indicator',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="sync-indicator" [class]="statusClass()">
      <span class="icon">{{ icon() }}</span>
      <span class="text">{{ text() }}</span>

      @if (showSaveButton()) {
        <button
          class="save-btn"
          (click)="saveToCloud()"
          [disabled]="isSyncing()"
          title="Guardar partida en la nube"
        >
          💾
        </button>
      }
    </div>
  `,
  styles: [`
    .sync-indicator {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.35rem 0.75rem;
      border-radius: 4px;
      font-size: 0.8rem;
      background: rgba(0, 0, 0, 0.3);
      border: 1px solid rgba(255, 255, 255, 0.1);
      transition: all 0.3s ease;

      &.idle {
        color: #888;
      }

      &.pending {
        color: #ffa500;
        border-color: rgba(255, 165, 0, 0.3);
      }

      &.syncing {
        color: #00d4ff;
        border-color: rgba(0, 212, 255, 0.3);

        .icon {
          animation: spin 1s linear infinite;
        }
      }

      &.success {
        color: var(--primary-color, #0d7337);
        border-color: rgba(var(--primary-rgb, 13, 115, 55), 0.3);
      }

      &.error {
        color: #ff4444;
        border-color: rgba(255, 68, 68, 0.3);
      }

      &.offline {
        color: #666;
        border-color: rgba(102, 102, 102, 0.3);
      }
    }

    .icon {
      font-size: 0.9rem;
    }

    .text {
      white-space: nowrap;
    }

    .save-btn {
      background: none;
      border: none;
      padding: 0.2rem;
      cursor: pointer;
      font-size: 1rem;
      opacity: 0.7;
      transition: all 0.2s;

      &:hover:not(:disabled) {
        opacity: 1;
        transform: scale(1.1);
      }

      &:disabled {
        opacity: 0.3;
        cursor: not-allowed;
      }
    }

    @keyframes spin {
      to { transform: rotate(360deg); }
    }
  `]
})
export class SyncIndicatorComponent {
  constructor(
    private syncService: SyncService,
    private authService: AuthService
  ) {}

  readonly status = computed(() => {
    if (this.authService.isOfflineMode()) return 'offline';
    return this.syncService.status();
  });

  readonly statusClass = computed(() => this.status());

  readonly icon = computed(() => {
    if (this.authService.isOfflineMode()) return '⚡';
    return this.syncService.getStatusIcon();
  });

  readonly text = computed(() => {
    if (this.authService.isOfflineMode()) return 'Modo Offline';
    return this.syncService.getStatusText();
  });

  readonly showSaveButton = computed(() => {
    return !this.authService.isOfflineMode() &&
           this.syncService.hasPendingChanges() &&
           this.syncService.status() !== 'syncing';
  });

  readonly isSyncing = computed(() => this.syncService.status() === 'syncing');

  async saveToCloud(): Promise<void> {
    await this.syncService.saveToCloud();
  }
}
