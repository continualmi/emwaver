#ifndef SAMPLER_H
#define SAMPLER_H

#include <stdbool.h>

void sampler_module_init(void);
void sampler_register_commands(void);
void sampler_stop_all(void);
bool sampler_is_sampling(void);
bool sampler_is_transmitting(void);
bool sampler_start_sampling(int pin);
bool sampler_stop_sampling(void);
bool sampler_start_transmission(int pin);
bool sampler_stop_transmission(void);

#endif /* SAMPLER_H */
