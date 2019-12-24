/* global Tone */
/* global Util */
/** Manages instruments and allows the playback of notes */
class NotePlayer { // eslint-disable-line no-unused-vars
  /**
   * Creates a NotePlayer. One player is sufficient for any number of instruments and notes.
   * @param {number} gridWidth - The width of the grid, in tiles
   * @param {number} gridHeight - The height of the grid, in tiles
   */
  constructor(gridWidth, gridHeight) {
    Util.assert(arguments.length === 2);

    this.gridWidth = gridWidth;
    this.gridHeight = gridHeight;

    // Construct scale array

    const pentatonic = ['B#', 'D', 'F', 'G', 'A'];
    const octave = 3; // base octave
    const octaveoffset = 4;
    let scale = Array(gridHeight);
    for (let i = 0; i < gridHeight; i += 1) {
      scale[i] = pentatonic[i % pentatonic.length]
        + (octave + Math.floor((i + octaveoffset) / pentatonic.length));
    }
    scale = scale.reverse(); // higher notes at lower y values, near the top

    // Pre-render synth

    this.numVoices = 3; // Number of voices (players) *per note*
    this.noteOffset = (Tone.Time('1m') / gridWidth) * 6; // Total note duration, including release. Used to offset the sound sprites

    this.players = [];

    this.currentPlayer = 0;

    const self = this;

    Tone.Offline(() => {
      const lowPass = new Tone.Filter({
        frequency: 1100,
        rolloff: -12,
      }).toMaster();

      const synth = new Tone.Synth({
        oscillator: {
          type: 'sine',
        },
        envelope: {
          attack: 0.005,
          decay: 0.1,
          sustain: 0.3,
          release: 1,
        },
      }).connect(lowPass);

      scale.forEach((el, idx) => {
        synth.triggerAttackRelease(el, Tone.Time('1m') / gridWidth, idx * self.noteOffset);
      });
    }, this.noteOffset * scale.length).then((buffer) => {
      for (let i = 0; i < scale.length * self.numVoices; i += 1) {
        this.players.push(new Tone.Player(buffer).toMaster());
      }
    });

    // Init polyphony tracker. More notes playing at the same time
    // means that each note needs to play quieter

    this.polyphony = Array(gridWidth).fill(0);
    this.notes = []; // Sparse array
  }

  /**
   * Schedules a note at an (x, y) grid coordinate
   * to automatically play at the appropriate time and pitch
   * @param {number} gridX - The x position of the note, in grid tiles
   * @param {number} gridY  - The y position of the note, in grid tiles
   * @returns {noteId} - The id of the note that's been scheduled, for use with unscheduleNote()
   */
  scheduleNote(gridX, gridY) {
    Util.assert(arguments.length === 2);
    // Cycle through the voices
    const noteDuration = Tone.Time('1m') / this.gridWidth;
    const playEvent = Tone.Transport.schedule((time) => {
      const highVolume = -10; // When one note is playing
      const lowVolume = -20; // When all notes are playing (lower volume to prevent peaking)

      const volume = ((this.gridHeight - this.polyphony[gridX]) / this.gridHeight)
        * (highVolume - lowVolume) + lowVolume;
      try {
        this.players[this.currentPlayer].volume.value = volume;
        this.players[this.currentPlayer].start(
          time, gridY * this.noteOffset, this.noteOffset,
        );
        this.currentPlayer = (this.currentPlayer + 1) % this.players.length;
      } catch (e) {
        // eslint-disable-next-line no-console
        if (Util.DEBUG) console.warn('Note play failure:', e);
      }
    }, gridX * noteDuration);
    this.notes[playEvent] = { x: gridX, y: gridY };
    this.polyphony[gridX] += 1;
    return playEvent;
  }

  /**
   * Unschedules a note so that it will no longer play
   * @param {noteId} id - The id of the note to unschedule
   */
  unscheduleNote(id) { // eslint-disable-line class-methods-use-this
    Util.assert(arguments.length === 1);
    const { x } = this.notes[id];
    delete this.notes[id];
    this.polyphony[x] -= 1;
    Util.assert(this.polyphony[x] >= 0);
    Tone.Transport.clear(id);
  }

  /**
   * Get the x position on the grid where the playhead currently is
   * @returns {number} - The x position
   */
  getPlayheadX() {
    const adjustedSeconds = Tone.Transport.seconds
      % (Tone.Transport.loopEnd - Tone.Transport.loopStart);
    const adjustedProgress = adjustedSeconds / (Tone.Transport.loopEnd - Tone.Transport.loopStart);
    return Math.floor(adjustedProgress * this.gridWidth);
  }
}
