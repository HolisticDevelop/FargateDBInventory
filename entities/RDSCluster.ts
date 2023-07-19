import {Database} from "./Database";
import {User} from "./User";

export interface RDSCluster {
    name: string
    host: string
    engine: string
    users: User[] | string
    databases: Database[] | string
}