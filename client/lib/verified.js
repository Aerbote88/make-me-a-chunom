import {AbstractStage} from '/client/lib/abstract';
import {getAnimationData} from '/lib/animation';

const kBaseSpeed = 0.02;
const kDefaultSpeed = 2;

const currentSpeed = () => {
  const value = Session.get('stages.verified.speed');
  return typeof value === 'number' && value > 0 ? value : kDefaultSpeed;
};

class VerifiedStage extends AbstractStage {
  constructor(glyph) {
    super('verified');
    this.strokes = glyph.stages.order.map(
        (x) => glyph.stages.strokes.corrected[x.stroke]);
    this.medians = glyph.stages.order.map((x) => x.median);
  }
  refreshUI() {
    Session.set('stage.status',
                [{cls: 'success', message: 'Character analysis complete.'}]);
    Session.set('stages.verified.strokes', this.strokes);
    Session.set('stages.verified.medians', this.medians);
    if (Session.get('stages.verified.speed') === undefined) {
      Session.set('stages.verified.speed', kDefaultSpeed);
    }
    // Force the {{#if showAnimation}} block to unmount and remount so the
    // CSS keyframes restart from the beginning. Without this, navigating
    // to a new character via the browser panel can leave the animation
    // frozen mid-way, because Blaze keeps the same <style> element and
    // just swaps its text — which does NOT restart animations in-flight.
    Session.set('stages.verified.showAnimation', false);
    Tracker.afterFlush(() => {
      Session.set('stages.verified.showAnimation', true);
    });
  }
}

Template.verified_stage.helpers({
  data: () => {
    const strokes = Session.get('stages.verified.strokes');
    const medians = Session.get('stages.verified.medians');
    if (!strokes || !medians) return undefined;
    return getAnimationData(strokes, medians,
                            {speed: kBaseSpeed * currentSpeed()});
  },
  showAnimation: () => Session.get('stages.verified.showAnimation') !== false,
  speed: () => currentSpeed(),
  speedLabel: () => `${currentSpeed().toFixed(2)}\u00d7`,
});

Template.verified_stage.events({
  'change .speed-slider': (event) => {
    const value = parseFloat(event.target.value);
    if (Number.isNaN(value) || value <= 0) return;
    Session.set('stages.verified.speed', value);
    Session.set('stages.verified.showAnimation', false);
    Tracker.afterFlush(() => {
      Session.set('stages.verified.showAnimation', true);
    });
  },
});

export {VerifiedStage};
