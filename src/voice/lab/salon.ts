import { demoPeople } from '../../demoSeed';
import { initialEmployees, initialServices } from '../../mockData';
import type { ReadingSalon } from './expected';

/**
 * The salon the voice check reads against: the services and the team of the app's own salon, and
 * its customers plus the one the sentences name. So a heard name has to be told apart from real
 * neighbours such as another Brunner or another Léa.
 */
export const CHECK_CUSTOMER = 'Lea Brunner';

export const checkSalon = (): Omit<ReadingSalon, 'today'> & { employees: typeof initialEmployees; services: typeof initialServices } => {
  const people = demoPeople().map(person => ({ name: person.name }));
  return {
    services: initialServices,
    employees: initialEmployees,
    customers: people.some(person => person.name === CHECK_CUSTOMER) ? people : [{ name: CHECK_CUSTOMER }, ...people],
  };
};
