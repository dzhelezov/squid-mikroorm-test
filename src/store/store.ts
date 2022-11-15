import assert from 'assert'
import {EntityManager, EntityClass} from '@mikro-orm/core'
import {FilterQuery} from '@mikro-orm/core/typings'
import e from 'cors'
// import {ColumnMetadata} from 'typeorm/metadata/ColumnMetadata'

// export interface EntityClass<T> {
//     new (): T
// }

export interface Entity {
    id: string
}

/**
 * Defines a special criteria to find specific entity.
 */
// export interface FindOneOptions<Entity = any> {
//     /**
//      * Adds a comment with the supplied string in the generated query.  This is
//      * helpful for debugging purposes, such as finding a specific query in the
//      * database server's logs, or for categorization using an APM product.
//      */
//     comment?: string
//     /**
//      * Indicates what relations of entity should be loaded (simplified left join form).
//      */
//     relations?: FindOptionsRelations<Entity>
//     /**
//      * Order, in which entities should be ordered.
//      */
//     order?: FindOptionsOrder<Entity>
// }

// export interface FindManyOptions<Entity = any> extends FindOneOptions<Entity> {
//     /**
//      * Offset (paginated) where from entities should be taken.
//      */
//     skip?: number
//     /**
//      * Limit (paginated) - max number of entities should be taken.
//      */
//     take?: number
// }
export type EntityFactory<E> = (id: string) => E
/**
 * Restricted version of TypeORM entity manager for squid data handlers.
 */
export class Store {
    private lazyEntityIds = new Map<EntityClass<Entity>, Set<string>>()
    private factories = new Map<EntityClass<Entity>, EntityFactory<Entity>>()

    constructor(private em: () => EntityManager) {}

    setFactory<E extends Entity>(entityClass: EntityClass<E>, factory: (id: string) => E) {
        this.factories.set(entityClass, factory)
    }

    lazyLoad<E extends Entity>(entityClass: EntityClass<E>, ids: string | string[]) {
        const lazyIds = this.getLazyEntityIds(entityClass)
        for (const id of ids) {
            lazyIds.add(id)
        }
        return this
    }

    async forceLoad<E extends Entity>(entityClass: EntityClass<E>): Promise<E[]>
    async forceLoad<E extends Entity>(): Promise<void>
    async forceLoad<E extends Entity>(entityClass?: EntityClass<E>): Promise<E[] | void> {
        if (entityClass) {
            return this.loadByEntityClass(entityClass)
        } else {
            for (const e of this.lazyEntityIds.keys()) {
                await this.loadByEntityClass(e)
            }
        }
    }

    private async loadByEntityClass<E extends Entity>(entityClass: EntityClass<E>): Promise<E[]> {
        const lazyIds = this.getLazyEntityIds(entityClass)
        if (lazyIds.size == 0) return []

        const entities = await this.find(entityClass, {id: {$in: [...lazyIds]}} as any)
        lazyIds.clear()

        return entities
    }

    async persistAll<E extends Entity>(entityClass: EntityClass<E>): Promise<E[]> {
        const lazyIds = this.getLazyEntityIds(entityClass)
        if (lazyIds.size == 0) return []

        const entities = await this.find(entityClass, {id: {$in: [...lazyIds]}} as any)

        const fetchedIds = new Set(entities.map((e) => e.id))
        for (const id of lazyIds) {
            if (fetchedIds.has(id)) continue
            const factory = this.factories.get(entityClass)
            assert(factory, `No ID ${id} is found and no factory is set for type ${entityClass.name}`)
            const e = factory(id)
            entities.push(e)
            this.em().persist(e)
        }
        lazyIds.clear()

        return entities
    }

    lazyRemove<E extends Entity>(...entities: E[]): void {
        // if (entities.length == 0) return
        // let entityClass = entities[0].constructor as EntityClass<E>
        // for (let i = 1; i < entities.length; i++) {
        //     assert(entityClass === entities[i].constructor, 'mass deletion allowed only for entities of the same class')
        // }
        this.em().remove(entities)
    }

    count<E extends Entity>(entityClass: EntityClass<E>, where?: FilterQuery<E>): Promise<number> {
        return this.em().count(entityClass, where)
    }

    find<E extends Entity>(entityClass: EntityClass<E>, where: FilterQuery<E>): Promise<E[]> {
        return this.em().find(entityClass, where)
    }

    findOne<E extends Entity>(entityClass: EntityClass<E>, where: FilterQuery<E>): Promise<E | undefined> {
        return this.em().findOne(entityClass, where).then(noNull)
    }

    findOneOrFail<E extends Entity>(entityClass: EntityClass<E>, where: FilterQuery<E>): Promise<E> {
        return this.em().findOneOrFail(entityClass, where)
    }

    getById<E extends Entity>(entityClass: EntityClass<E>, id: string): Promise<E | undefined> {
        return this.findOne<E>(entityClass, {id} as any)
    }

    async persist<E extends Entity>(
        entityClass: EntityClass<E>,
        id: string
    ): Promise<E | undefined> {
        let e = await this.getById(entityClass, id)
        if (!e) {
            const factory = this.factories.get(entityClass)
            assert(factory, `The database has no id ${id} and no factory is set for type ${entityClass.name}`)
            e = <E>factory(id)
            this.em().persist(e)
        }
        return e
    }

    lazyPersist<E extends Entity>(e: E | E[]) {
        return this.em().persist(e)
    }

    flush(): Promise<void> {
        return this.em().flush()
    }

    clear() {
        return this.em().clear()
    }

    refresh<E extends Entity>(...entities: E[]) {
        return this.em().refresh(entities)
    }

    private getLazyEntityIds<E extends Entity>(entityClass: EntityClass<E>): Set<string> {
        let ids = this.lazyEntityIds.get(entityClass)
        if (!ids) {
            ids = new Set()
            this.lazyEntityIds.set(entityClass, ids)
        }
        return ids
    }
}


function noNull<T>(val: null | undefined | T): T | undefined {
    return val == null ? undefined : val
}
