#include <stdlib.h>
#include "neaacdec.h"

typedef struct {
  NeAACDecHandle handle;
  NeAACDecFrameInfo info;
  unsigned long rate;
  unsigned char channels;
} WaveAac;

WaveAac *wa_open(void) {
  WaveAac *d = calloc(1, sizeof(WaveAac));
  if (!d) return NULL;
  d->handle = NeAACDecOpen();
  NeAACDecConfigurationPtr config = NeAACDecGetCurrentConfiguration(d->handle);
  config->outputFormat = FAAD_FMT_16BIT;
  config->downMatrix = 1;
  NeAACDecSetConfiguration(d->handle, config);
  return d;
}

int wa_init_config(WaveAac *d, unsigned char *config, unsigned long size) {
  return NeAACDecInit2(d->handle, config, size, &d->rate, &d->channels) < 0 ? -1 : 0;
}

long wa_init_stream(WaveAac *d, unsigned char *buffer, unsigned long size) {
  return NeAACDecInit(d->handle, buffer, size, &d->rate, &d->channels);
}

short *wa_decode(WaveAac *d, unsigned char *buffer, unsigned long size) {
  return (short *)NeAACDecDecode(d->handle, &d->info, buffer, size);
}

void wa_reset(WaveAac *d, long frame) {
  NeAACDecPostSeekReset(d->handle, frame);
}

unsigned long wa_init_rate(WaveAac *d) { return d->rate; }
int wa_init_channels(WaveAac *d) { return d->channels; }
unsigned long wa_consumed(WaveAac *d) { return d->info.bytesconsumed; }
unsigned long wa_samples(WaveAac *d) { return d->info.samples; }
int wa_channels(WaveAac *d) { return d->info.channels; }
unsigned long wa_rate(WaveAac *d) { return d->info.samplerate; }
int wa_error(WaveAac *d) { return d->info.error; }

void wa_close(WaveAac *d) {
  if (!d) return;
  NeAACDecClose(d->handle);
  free(d);
}
