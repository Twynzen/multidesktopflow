import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { CYBER_ICONS, CyberIconName } from '../../icons/cyber-icons';

@Component({
  selector: 'app-cyber-icon',
  standalone: true,
  imports: [CommonModule],
  template: `<span class="cyber-icon" [style.width]="size" [style.height]="size" [innerHTML]="iconSvg"></span>`,
  styles: [`
    .cyber-icon {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      line-height: 1;

      :host-context(.cyber-icon) ::ng-deep svg {
        width: 100%;
        height: 100%;
      }
    }
  `]
})
export class CyberIconComponent {
  @Input() name: CyberIconName = 'logo';
  @Input() size: string = '1em';

  constructor(private sanitizer: DomSanitizer) {}

  get iconSvg(): SafeHtml {
    const svg = CYBER_ICONS[this.name] || CYBER_ICONS.logo;
    return this.sanitizer.bypassSecurityTrustHtml(svg);
  }
}
