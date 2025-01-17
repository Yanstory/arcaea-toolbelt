import { BeyondAddon, Chart, Difficulty, SongData } from "../models/music-play";
import { groupBy, indexBy } from "../utils/collections";
import { arcaeaCNClient } from "./cached-fetch";
import { Pack, PackList, Song, SongList } from "./packed-data";
import { wikiURL, initPageDocument, htmlDocument, prepareDocument } from "./wiki-util";

const wikiConstantTable = wikiURL("定数详表");

interface ConstantChartData {
  name: string;
  pst: number;
  prs: number;
  ftr: number;
  byd: number | null;
  link: string;
}
/**
 * 从wiki爬数据的主要出于使用wiki上曲绘的考虑
 */
async function getWikiChartTable() {
  await initPageDocument(wikiConstantTable);
  const constantTableEl = htmlDocument.querySelector("table")!;
  type TD = HTMLTableCellElement;
  function checkCells(cells: TD[]): asserts cells is [TD, TD, TD, TD, TD] {
    if (cells.length !== 5) {
      throw new Error("wiki定数详表格式改变");
    }
  }

  const songs: ConstantChartData[] = [];
  for (let i = 1, rows = constantTableEl.rows, l = rows.length; i < l; i++) {
    const row = rows[i]!;
    const cells = Array.from(row.cells);
    checkCells(cells);
    const [name, past, present, future, beyond] = cells;
    const songName = name.textContent!.trim();
    // Last一系列比较特殊，跳过
    if (songName === "Last" || songName === "Last | Eternity") {
      continue;
    }
    songs.push({
      name: songName,
      pst: +past.textContent!,
      prs: +present.textContent!,
      ftr: +future.textContent!,
      byd: beyond.textContent!.trim() ? +beyond.textContent! : null,
      link: new URL(name.querySelector("a")!.href).pathname,
    });
  }
  return songs;
}

async function getArcInfData() {
  const res = await fetch("https://raw.githubusercontent.com/Arcaea-Infinity/ArcaeaSongDatabase/main/arcsong.json");
  type ArcInfChartData = {
    name_en: string;
    /**
     * 曲包名
     */
    set_friendly: string;
    /**
     * 定数的十倍
     */
    rating: number;
  };

  type ArcInfSongData = {
    song_id: string;
    alias: string[];
    difficulties: ArcInfChartData[];
  };

  const arcInfinityData: ArcInfSongData[] = (await res.json()).songs;
  const indexed = arcInfinityData.reduce<{ [name: string]: ArcInfSongData[] }>((map, song) => {
    const chart = song.difficulties[0]!;
    const songName = chart.name_en;
    if (map[songName]) {
      console.log(`重名歌曲：${songName}`);
    }
    const songs: ArcInfSongData[] = (map[songName] ??= []);
    songs.push(song);
    return map;
  }, {});
  return {
    getSong(name: string, { pst, prs, ftr, byd }: ConstantChartData): ArcInfSongData | null {
      const songs = indexed[name];
      if (!songs) {
        console.error(`曲目 ${name} 在Arcaea Infinity内未找到`);
        return null;
      }
      if (songs.length === 1) {
        return songs[0]!;
      }
      // 重名曲目，看谱面定数区分
      const song = songs.filter((song) =>
        [pst, prs, ftr, byd].every((c, i) => {
          if (c == null) {
            return true;
          }
          const difficulty = song.difficulties[i];
          if (!difficulty) {
            console.error(`${name} ${[pst, prs, ftr, byd]} 没有难度 ${i}`);
            return null;
          }
          // 浮点误差
          return Math.abs(difficulty.rating / 10 - c) < 0.01;
        })
      );

      if (song.length !== 1) {
        console.error(`这都能重复，没救了`);
        return null;
      }
      return song[0]!;
    },
    raw: arcInfinityData,
  };
}

function getWikiTableItemsByLabel(label: Element) {
  const nodes: Element[] = [];
  for (let node = label.nextElementSibling; node && !node.matches(".label"); node = node.nextElementSibling) {
    nodes.push(node);
  }
  return nodes;
}

export async function getSongData(songList: SongList, packList: PackList): Promise<SongData[]> {
  const songs = await getWikiChartTable();
  const songGroup = groupBy(songList.songs, (s) => s.title_localized.en.trim());
  const packIndex = indexBy(packList.packs, (p) => p.id);
  const getPackName = (song: Song) => {
    const pack = packIndex[song.set];
    if (pack) {
      const segments: string[] = [];
      for (let p: Pack | undefined = pack; p; p = p.pack_parent ? packIndex[p.pack_parent] : undefined) {
        segments.push(p.name_localized.en);
      }
      return segments.reverse().join(" - ");
    }
    return "Memory Archive";
  };
  const getSongByNameAndBpm = (title: string, bpm: string) => {
    const group = songGroup[title];
    if (group?.length === 1) {
      return group[0]!;
    }
    const found = group?.find((s) => s.bpm === bpm);
    if (!found) {
      debugger;
    }
    return found;
  };
  const arcInf = await getArcInfData();
  const songsData: SongData[] = [];
  const difficulties = [Difficulty.Past, Difficulty.Present, Difficulty.Future] satisfies Difficulty[];
  for (const song of songs) {
    const { name, link, byd } = song;
    const arcInfSong = arcInf.getSong(name, song);
    // 由于歌曲wiki链接是唯一的，因此wiki链接可以作为歌曲id使用
    const songId = link.slice(1);
    const detailPageURL = wikiURL(link);
    const content = await arcaeaCNClient.fetchAsText(detailPageURL);
    prepareDocument(content, detailPageURL);
    const [normal, beyond] = Array.from(htmlDocument.querySelectorAll("#right-image img"));
    if (!normal) {
      throw new Error(`${name} 曲绘未找到`);
    }
    const cover = wikiURL(normal.src).toString();
    const labels = Array.from(htmlDocument.querySelectorAll("div#mw-content-text div.label"));
    const bpmLabel = labels.find((label) => label.textContent!.match(/BPM/i))!;
    const bpm = bpmLabel.nextElementSibling!.textContent!;
    const noteLabel = labels.find((label) => label.textContent!.match(/^note/i))!;
    const notes: number[] = getWikiTableItemsByLabel(noteLabel).map((el) => +el.textContent!);
    const levelLabel = labels.find((label) => label.textContent!.match(/等级/i))!;
    const levels: string[] = getWikiTableItemsByLabel(levelLabel).map((el) => el.textContent!);
    const charts = difficulties.map<Chart>((difficulty, i) => ({
      constant: song[difficulty],
      difficulty,
      id: `${songId}@${difficulty}`,
      level: levels[i]!,
      note: notes[i]!,
      songId,
    }));
    const songListSong = getSongByNameAndBpm(name, bpm);
    if (!songListSong) {
      throw new Error(`song list内未找到${name}`);
    }
    if (byd) {
      const addon: BeyondAddon = {};
      if (beyond) {
        addon.cover = wikiURL(beyond.src).toString();
      }
      const bydDifficulty = songListSong.difficulties[3];
      if (!bydDifficulty) {
        throw new Error(`song list的数据不包含 ${name} 的byd谱`);
      }
      const name_en = bydDifficulty.title_localized?.en;
      if (name_en && name_en !== name) {
        addon.song = name_en;
      }
      const bydChart: Chart = {
        constant: byd,
        difficulty: Difficulty.Beyond,
        id: `${songId}@${Difficulty.Beyond}`,
        level: levels[3]!,
        note: notes[3]!,
        songId,
        byd: addon,
      };
      charts.push(bydChart);
    }
    const songData: SongData = {
      bpm,
      cover,
      name,
      id: songId,
      sid: songListSong.id,
      alias: arcInfSong?.alias ?? [],
      charts,
      pack: getPackName(songListSong),
    };
    songsData.push(songData);
  }
  (() => {
    // Last比较特殊，有五个谱面，两个byd难度和三个曲绘，直接作为固定内容处理
    const song: Partial<Record<Difficulty, number>> = {
      pst: 4.0,
      prs: 7.0,
      ftr: 9.0,
    };
    const notes = [674, 777, 831];
    const songId = "Last";
    const levels = ["4", "7", "9"];
    const last = "last";
    const lasteternity = "lasteternity";
    const pack = "Silent Answer";
    songsData.push({
      bpm: "175",
      cover: wikiURL("/images/thumb/a/a2/Songs_last.jpg/256px-Songs_last.jpg").toString(),
      id: "Last",
      sid: last,
      name: "Last",
      pack,
      alias: arcInf.raw.find((s) => s.song_id === last)!.alias,
      charts: difficulties
        .map<Chart>((difficulty, i) => ({
          constant: song[difficulty]!,
          difficulty,
          id: `${songId}@${difficulty}`,
          level: levels[i]!,
          note: notes[i]!,
          songId,
        }))
        .concat([
          {
            id: `Last | Moment@${Difficulty.Beyond}`,
            constant: 9.6,
            difficulty: Difficulty.Beyond,
            level: "9",
            note: 888,
            songId,
            byd: {
              song: `Last | Moment`,
              cover: wikiURL("/images/thumb/1/1e/Songs_last_byd.jpg/256px-Songs_last_byd.jpg").toString(),
            },
          },
        ]),
    });
    songsData.push({
      bpm: "175",
      cover: wikiURL("/images/thumb/9/92/Songs_lasteternity.jpg/256px-Songs_lasteternity.jpg").toString(),
      id: "Last | Eternity",
      name: "Last | Eternity",
      pack,
      sid: lasteternity,
      alias: arcInf.raw.find((s) => s.song_id === lasteternity)!.alias,
      charts: [
        {
          id: `Last | Eternity@${Difficulty.Beyond}`,
          constant: 9.7,
          difficulty: Difficulty.Beyond,
          level: "9+",
          note: 786,
          songId,
          byd: {
            song: `Last | Eternity`,
          },
        },
      ],
    });
  })();
  return songsData;
}
