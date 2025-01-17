import { sheet } from "./style.css.js";
import { bootstrap } from "../../styles";
import { Inject } from "../../../services/di";
import { $WorldModeService, WorldModeService } from "../../../services/declarations";
import { Chapter, NormalWorldMap, RewardType } from "../../../models/world-mode";
import { Component, For, HyplateElement, signal, watch } from "hyplate";
import type { Mountable } from "hyplate/types";

export
@Component({
  tag: "world-map-select",
  styles: [bootstrap, sheet],
})
class WorldMapSelect extends HyplateElement {
  @Inject($WorldModeService)
  accessor worldmode!: WorldModeService;

  longtermMaps = signal<Chapter[]>([]);
  eventMaps = signal<NormalWorldMap[]>([]);
  selected = signal<NormalWorldMap | null>(null);
  longtermSelected = signal("");
  eventSelected = signal("");

  override render(): Mountable<any> {
    this.fetchMapData();
    this.effect(() =>
      watch(this.longtermSelected, (value) => {
        if (value) {
          this.eventSelected.set("");
          this.selected.set(
            this.longtermMaps()
              .flatMap((c) => c.maps)
              .find((m) => m.id === value) ?? null
          );
        }
      })
    );
    this.effect(() =>
      watch(this.eventSelected, (value) => {
        if (value) {
          this.longtermSelected.set("");
          this.selected.set(this.eventMaps().find((m) => m.id === value) ?? null);
        }
      })
    );
    return (
      <div class="row">
        <div class="col">
          <select class="form-select" name="longterm" h-model={this.longtermSelected}>
            <option value="">--常驻地图--</option>
            <For of={this.longtermMaps}>
              {(item) => <optgroup label={item.chapter}>{item.maps.map((map) => this.renderMapOption(map))}</optgroup>}
            </For>
          </select>
        </div>
        <div class="col">
          <select class="form-select" name="event" h-model={this.eventSelected}>
            <option value="">--活动地图--</option>
            <For of={this.eventMaps}>{(item) => this.renderMapOption(item)}</For>
          </select>
        </div>
      </div>
    );
  }

  fetchMapData(): void {
    this.worldmode.getLongtermMaps().then((chapterData) => {
      this.longtermMaps.set(chapterData);
    });
    this.worldmode.getEventMaps().then((maps) => {
      this.eventMaps.set(maps);
    });
  }

  private renderMapOption(map: NormalWorldMap) {
    const rewards = this.worldmode.getMapRewards(map);
    const buf: string[] = [];
    if (RewardType.Character in rewards) {
      buf.push(`搭档 ${rewards[RewardType.Character]!}`);
    }
    if (RewardType.Song in rewards) {
      buf.push(`曲目 ${rewards[RewardType.Song]!}`);
    }
    if (RewardType.Background in rewards) {
      buf.push(`背景 ${rewards[RewardType.Background]!}`);
    }
    return (
      <option value={map.id} title={map.id}>
        {map.id}
        {buf.length ? ` (奖励：${buf.join(" ")})` : ""}
      </option>
    );
  }
}
