import { Component, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { SyncService } from '../../services/sync.service';
import { AuthService } from '../../services/auth.service';

@Component({
  selector: 'app-sync-indicator',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="sync-indicator" [class]="statusClass()">
      <span class="icon" [innerHTML]="iconSvg()"></span>
      <span class="text">{{ text() }}</span>

      @if (showSaveButton()) {
        <button
          class="save-btn"
          (click)="saveToCloud()"
          [disabled]="isSyncing()"
          title="Guardar partida en la nube"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/>
            <polyline points="17 21 17 13 7 13 7 21"/>
            <polyline points="7 3 7 8 15 8"/>
          </svg>
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
      display: inline-flex;
      align-items: center;
      justify-content: center;

      :host ::ng-deep svg {
        width: 14px;
        height: 14px;
      }
    }

    .text {
      white-space: nowrap;
    }

    .save-btn {
      background: none;
      border: none;
      padding: 0.2rem;
      cursor: pointer;
      opacity: 0.7;
      transition: all 0.2s;
      display: inline-flex;
      align-items: center;

      svg {
        width: 16px;
        height: 16px;
      }

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
  private readonly ICONS = {
    bolt: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>`,
    sync: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>`,
    check: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>`,
    alert: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`,
    cloud: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z"/></svg>`
  };

  constructor(
    private syncService: SyncService,
    private authService: AuthService,
    private sanitizer: DomSanitizer
  ) {}

  readonly status = computed(() => {
    if (this.authService.isOfflineMode()) return 'offline';
    return this.syncService.status();
  });

  readonly statusClass = computed(() => this.status());

  readonly iconSvg = computed((): SafeHtml => {
    if (this.authService.isOfflineMode()) {
      return this.sanitizer.bypassSecurityTrustHtml(this.ICONS.bolt);
    }
    const status = this.syncService.status();
    let svg = this.ICONS.cloud;
    switch (status) {
      case 'syncing': svg = this.ICONS.sync; break;
      case 'success': svg = this.ICONS.check; break;
      case 'error': svg = this.ICONS.alert; break;
      case 'pending': svg = this.ICONS.cloud; break;
    }
    return this.sanitizer.bypassSecurityTrustHtml(svg);
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
